# Build the historical MinIO versions used by SkyHub from the official sources.
# Container registries no longer reliably expose these archived release images.
FROM golang:1.23-alpine AS build

ARG MINIO_VERSION=RELEASE.2024-12-18T13-15-44Z
ARG MC_VERSION=RELEASE.2024-11-21T17-21-54Z

RUN apk add --no-cache ca-certificates git
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install "github.com/minio/minio@${MINIO_VERSION}"
RUN go install "github.com/minio/mc@${MC_VERSION}"

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /out/mc /usr/local/bin/mc

EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
