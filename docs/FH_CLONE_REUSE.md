# FH-Clone reuse in SkyHub

SkyHub intentionally reuses protocol knowledge and validation rules from the
owner's FH-Clone project while keeping the SkyHub runtime Python/FastAPI based.

Reference snapshot:

- repository: mason82-dotcom/FH-Clone
- main commit: c649c53b69cbef7b31e65ca610c4b85654cd3657
- DJI topology source: cc7c9b791f4fb040ba51c57d6ac5ceff0daeddd7
- DJI RTK source: ffd9bbe7a530067f363a3661b0892c14449ebf43
- DJI normalizer source: 338768d692bf2593c51e039b284fcdcc9369672d
- normalizer tests: 1bbf3b8d18c0b12002a62343d93cdcf1a457ce30
- M3M MQTT evidence: 2a61792a7b76bbf1f2d179b70dcd89391fc1175a

## Ported contracts

1. update_topo identities are fail-closed. Numeric type/sub_type are required;
   malformed subdevices are skipped instead of being assigned guessed IDs.
2. Mavic 3M identity 0-77-2 and payload index 68-0-0 are backed by the real,
   redacted FH-Clone M3M MQTT evidence captured on 2026-10-01.
3. This hardware observation does not claim that DJI lists M3M as an officially
   supported Cloud API product.
4. position_state.is_fixed is treated as generic satellite acquisition state.
   It is not sufficient by itself to label RTK as fixed.
5. RTK fixed is kept separate from GNSS fixed. The FH-Clone parser uses
   position_state.quality == 10, with a consistent acquisition state, as the
   explicit RTK-fixed indication.
6. height and elevation retain separate semantics: ellipsoid altitude and
   takeoff-relative altitude respectively.
7. Camera and gimbal data are keyed by validated DJI payload_index values.

No DJI Cloud API demo source code is imported by this reuse layer.
