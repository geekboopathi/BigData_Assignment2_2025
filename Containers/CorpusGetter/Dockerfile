FROM alpine:3.20

# Tools we need
RUN apk add --no-cache bash perl coreutils tar findutils

# 1) Put the seed tar files INSIDE the image (not under /QualitasCorpus)
#    so they are not hidden by the runtime volume mount.
WORKDIR /opt/qc-seed
# These two files must exist in the build context (this folder) before building
COPY QualitasCorpus-20130901r-pt1.tar ./
COPY QualitasCorpus-20130901r-pt2.tar ./

# 2) Runtime script
WORKDIR /app
COPY qc-get.sh .

# 🔧 FIX line endings + ensure executable (prevents `bash\r` error)
RUN sed -i 's/\r$//' /app/qc-get.sh && chmod +x /app/qc-get.sh

# 3) Create the mount point for the volume
RUN mkdir -p /QualitasCorpus
VOLUME ["/QualitasCorpus"]

ENTRYPOINT ["/app/qc-get.sh"]
