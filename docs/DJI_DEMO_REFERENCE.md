# DJI Cloud API Demo reference policy

SkyHub may use the retired official DJI Cloud API Demo as a protocol reference,
but does not import its application architecture wholesale.

Reference snapshot:

- repository: dji-sdk/DJI-Cloud-API-Demo
- commit: bef525cb92772b06786c1e033719a6fa1b94bcc5
- license: MIT, Copyright (c) 2022 DJI-SDK
- upstream maintenance notice: DJI announced the Demo end-of-maintenance on
  2025-04-10 and warns that it is not a production-grade solution.

## Reviewed source contracts

- MQTT topic classifier:
  cloud-sdk/src/main/java/com/dji/sdk/mqtt/CloudApiTopicEnum.java
  SHA: 4ab6f4c106986d7eaf44690557d109706fbd2f9b
- MQTT topic fragments:
  cloud-sdk/src/main/java/com/dji/sdk/mqtt/TopicConst.java
  SHA: 8b957de0289a762ed60cfec073259992b90c1042
- livestream start request:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/livestream/LiveStartPushRequest.java
  SHA: e99507b960c7c42cad2ac1da13d31415e49547a5
- livestream URL type enum:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/livestream/UrlTypeEnum.java
  SHA: 3c78adce7e7cf5a7a503cfd3225f1bdb870457a6
- livestream quality enum:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/livestream/VideoQualityEnum.java
  SHA: df4479d8709ac43854b0b2e6860beb96f0e1bd51
- video-id representation:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/device/VideoId.java
  SHA: a61b77bb9a796231e1d8cf6f76d249ee10790089
- payload-index representation:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/device/PayloadIndex.java
  SHA: c3c842f7ece8e8b75adb698fc8d21f1f710884b8
- wayline template enum:
  sample/src/main/java/com/dji/sample/wayline/model/enums/WaylineTemplateTypeEnum.java
  SHA: 760fc8dbe48a6500b7c5993c7977b7f7d4b594b3
- STS response/token contracts:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/storage/StsCredentialsResponse.java
  SHA: 0821274504850d3075fb80aae9c2ea4eda70c726
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/storage/CredentialsToken.java
  SHA: c8ffc0ee7b13c9541dd6c3edde556a3afdcdd797
- HTTP storage interface:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/storage/api/IHttpStorageService.java
  SHA: 602a8d2775140dae7dd03e74971ef671c8d22b85
- media HTTP/request contracts:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/media/api/IHttpMediaService.java
  SHA: 81a23e00baf46f9d9b659d55d2c725e15c66398f
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/media/MediaUploadCallbackRequest.java
  SHA: 6567ea331a70683acef46fa66ed3084d77777339
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/media/FolderUploadCallbackRequest.java
  SHA: 78abab4b0c71ebbd768d82c49a4cef6f86252505
- map HTTP/DTO contracts:
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/map/api/IHttpMapService.java
  SHA: be0530b2fa8e80f8d6f322db1bd3c90e94dcc442
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/map/GetMapElementsResponse.java
  SHA: f2c41e1d8261d3256b23f8342e29eea228efc1d8
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/map/CreateMapElementRequest.java
  SHA: 8c5947c170cf6c8074b3ba419c22bbc3e2f5a983
  cloud-sdk/src/main/java/com/dji/sdk/cloudapi/map/UpdateMapElementRequest.java
  SHA: 1c712be3c0ac01ed2df806e540c4d785b54cabef

## What SkyHub reuses

SkyHub implements its own Python code for:

- validation/classification of documented MQTT topic shapes;
- the documented livestream URL-type and quality value domains;
- validation of DJI serial, payload_index, and video_id shapes;
- a fail-closed allowlist around the currently implemented server-to-device
  service calls;
- the DJI STS credential safety margin and POST-only STS endpoint contract;
- strict UUID/GeoJSON-like validation for Pilot map groups and elements;
- required Media fast-upload, upload-callback, tiny-fingerprint and
  group-upload callback fields before persistence.

These are protocol contracts and independently implemented validation rules.
The original Java application code is not vendored into SkyHub.

## Explicitly excluded

The following Demo implementation layers must not be copied into SkyHub without
a separate security review and explicit project decision:

- authentication, authorization and token/session handling;
- Spring controllers and request interceptors;
- Redis and database service implementations;
- object-storage credential handling;
- WebSocket/session code;
- arbitrary aircraft-control or DRC command paths;
- deployment/security defaults from the retired sample application.

For protocol behavior, current DJI documentation remains the primary reference.
FH-Clone real-hardware evidence is used independently to verify observed device
behavior. The Demo is a compatibility reference, not a production baseline.

Upstream license:
https://github.com/dji-sdk/DJI-Cloud-API-Demo/blob/main/LICENSE
