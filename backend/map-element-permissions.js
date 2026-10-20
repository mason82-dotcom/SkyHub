'use strict';

// SkyHub map-element access matrix. It is intentionally separate from DJI
// authentication and never trusts request-supplied roles or workspace IDs.
// Every write operation is disabled until a reviewed, separate implementation.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES=Object.freeze(['viewer','pilot','operator','admin']);
const WRITE_ACTIONS=new Set(['create','update','delete']);

function mapPrincipal(role,workspaceId){
  if(!ROLES.includes(role)||typeof workspaceId!=='string'||!UUID.test(workspaceId))
    return null;
  return Object.freeze({role,workspaceId});
}

function mapAccess(subject,{workspaceId,action='read',isDistributed=true}={}){
  if(!subject||typeof subject!=='object'||Array.isArray(subject)||
    !ROLES.includes(subject.role)||
    typeof subject.workspaceId!=='string'||!UUID.test(subject.workspaceId)||
    typeof workspaceId!=='string'||!UUID.test(workspaceId)||
    subject.workspaceId!==workspaceId)return false;
  // This module does not authorize ANY writes, even for admins, until a future
  // explicit feature flag, persistent role grants, audit trail and tests exist.
  if(WRITE_ACTIONS.has(action))return false;
  if(action!=='read'||typeof isDistributed!=='boolean')return false;
  if(subject.role==='pilot')return isDistributed;
  // Operator/admin roles are a future independently-authenticated capability.
  // Pairing/bootstrapping NEVER issues either role.
  return subject.role==='operator'||subject.role==='admin';
}

module.exports={mapPrincipal,mapAccess};
