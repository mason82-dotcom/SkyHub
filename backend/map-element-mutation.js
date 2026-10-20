'use strict';

// P2 internal-only, transactional mutation engine. NOT imported by server.js.
// There is no HTTP, DJI MQTT, WebSocket or Pilot 2 write entrypoint.
// Callers must eventually supply an authenticated server-side actor, never
// a JSON body or headers presented by an untrusted client.
const {parseMapElementGroups}=require('./map-element-contract');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTOR_ID=/^[A-Za-z0-9_.:@-]{1,128}$/;
const ACTIONS=new Set(['create','update','delete']);
const MAX_REVISION=Number.MAX_SAFE_INTEGER;

function validId(s,max=128){
  return typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s);
}

// Independent future policy. Existing mapAccess() continues denying ALL writes.
// No current SkyHub token can resolve to an operator/admin actor.
function authorizedActor(actor,workspaceId){
  return actor!==null&&typeof actor==='object'&&!Array.isArray(actor)&&
    ['operator','admin'].includes(actor.role)&&
    typeof actor.id==='string'&&ACTOR_ID.test(actor.id)&&
    typeof actor.workspaceId==='string'&&UUID.test(actor.workspaceId)&&
    actor.workspaceId===workspaceId;
}
function normalizedElement(groupId,elementId,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.id!==elementId)
    return null;
  try{
    const result=parseMapElementGroups({code:0,data:[
      {id:groupId,name:groupId,elements:[input]}
    ]});
    if(result.rejectedElements!==0||result.groups[0].elements.length!==1)return null;
    const el=result.groups[0].elements[0];
    if(!validId(el.name,255))return null;
    return el;
  }catch(_err){return null;}
}
function createMapMutationStore(pool,{clock=Date.now}={}){
  if(!pool||typeof pool.connect!=='function')throw new TypeError('Database pool required');
  if(typeof clock!=='function')throw new TypeError('Clock required');
  async function mutate({actor,workspaceId,groupId,elementId,action,expectedRevision,element}={}){
    // Validate permission and payload BEFORE opening the database transaction.
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||
      !authorizedActor(actor,workspaceId))return {status:'denied'};
    if(!validId(groupId)||!validId(elementId)||!ACTIONS.has(action))return {status:'invalid'};
    if(action==='create' ? expectedRevision!==undefined :
      !Number.isSafeInteger(expectedRevision)||expectedRevision<1||
      expectedRevision>=MAX_REVISION)return {status:'invalid'};
    const item=action==='delete'?null:normalizedElement(groupId,elementId,element);
    if(action!=='delete'&&!item)return {status:'invalid'};
    const timestamp=clock();
    if(!Number.isSafeInteger(timestamp)||timestamp<0)return {status:'invalid'};

    const client=await pool.connect();
    let inTransaction=false;
    try{
      await client.query('BEGIN');
      inTransaction=true;
      // Serialize edits by locking the group. Unknown lock status is DENIED.
      const group=await client.query(
        'SELECT is_locked FROM dji_map_element_groups WHERE workspace_id=$1 AND group_id=$2 FOR UPDATE',
        [workspaceId,groupId]);
      if(group.rows.length!==1){
        await client.query('ROLLBACK');inTransaction=false;
        return {status:'not_found'};
      }
      if(group.rows[0].is_locked!==false){
        await client.query('ROLLBACK');inTransaction=false;
        return {status:'locked'};
      }
      let result,newRevision=null;
      if(action==='create'){
        result=await client.query(
          'INSERT INTO dji_map_elements ('+
          'workspace_id,group_id,element_id,name,resource_type,geometry,color,'+
          'clamp_to_ground,is_3d,create_time,update_time,revision) '+
          'VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10,1) '+
          'ON CONFLICT DO NOTHING RETURNING revision',
          [workspaceId,groupId,elementId,item.name,item.resourceType,
            JSON.stringify(item.geometry),item.color,item.clampToGround,item.is3d,timestamp]);
      }else if(action==='update'){
        result=await client.query(
          'UPDATE dji_map_elements SET '+
          'name=$5,resource_type=$6,geometry=$7::jsonb,color=$8,'+
          'clamp_to_ground=$9,is_3d=$10,update_time=$11,revision=revision+1 '+
          'WHERE workspace_id=$1 AND group_id=$2 AND element_id=$3 AND revision=$4 '+
          'RETURNING revision',
          [workspaceId,groupId,elementId,expectedRevision,item.name,
            item.resourceType,JSON.stringify(item.geometry),item.color,
            item.clampToGround,item.is3d,timestamp]);
      }else{
        result=await client.query(
          'DELETE FROM dji_map_elements WHERE workspace_id=$1 AND group_id=$2 '+
          'AND element_id=$3 AND revision=$4 RETURNING revision',
          [workspaceId,groupId,elementId,expectedRevision]);
      }
      if(result.rows.length!==1){
        await client.query('ROLLBACK');inTransaction=false;
        return {status:'conflict'};
      }
      if(action!=='delete')newRevision=Number(result.rows[0].revision);
      if(action!=='delete'&&(!Number.isSafeInteger(newRevision)||newRevision<1))
        throw new Error('Invalid database revision');
      const oldRevision=action==='create'?null:expectedRevision;
      await client.query(
        'INSERT INTO dji_map_element_audit '+
        '(workspace_id,group_id,element_id,actor_id,action,old_revision,new_revision) '+
        'VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [workspaceId,groupId,elementId,actor.id,action,oldRevision,newRevision]);
      await client.query('COMMIT');
      inTransaction=false;
      return {status:'ok',revision:newRevision};
    }catch(_err){
      if(inTransaction){
        try{await client.query('ROLLBACK');}catch(_rollbackError){}
      }
      // Do not expose SQL or credentials in a future API response.
      throw new Error('Map mutation storage unavailable');
    }finally{
      client.release();
    }
  }
  return {mutate};
}

module.exports={createMapMutationStore,authorizedActor,normalizedElement};
