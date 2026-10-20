'use strict';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMapElementHandler({store,workspaceId,authorize}){
  if(typeof authorize!=='function')throw new TypeError('Authorization function required');
  return async function getElementGroups(req,res){
    if(!req.secure)return res.status(403).json({error:'HTTPS required'});
    const token=req.headers?.['x-auth-token'];
    let authorized=false;
    try{authorized=await authorize(token);}catch(_err){
      return res.status(503).json({error:'Authorization unavailable'});
    }
    if(!authorized)return res.status(401).json({error:'Unauthorized'});
    if(typeof workspaceId!=='string'||!UUID.test(workspaceId)||req.params?.workspaceId!==workspaceId)
      return res.status(404).json({error:'Workspace not found'});

    const rawGroupId=req.query?.group_id;
    const groupId=rawGroupId===undefined?null:rawGroupId;
    if(groupId!==null&&(typeof groupId!=='string'||!groupId.length||groupId.length>128))
      return res.status(400).json({error:'Invalid group_id'});
    const rawDistribution=req.query?.is_distributed;
    const isDistributed=rawDistribution===undefined?true:
      rawDistribution==='true'?true:rawDistribution==='false'?false:null;
    if(isDistributed===null)return res.status(400).json({error:'Invalid is_distributed'});
    if(!store)return res.status(503).json({error:'Map element storage unavailable'});
    try{
      return res.json(await store.readResponse(workspaceId,{groupId,isDistributed}));
    }catch(_err){
      return res.status(503).json({error:'Map element storage unavailable'});
    }
  };
}

module.exports={createMapElementHandler};
