PROJECT_DIR="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)"
DOCKER_IMAGE_ID="$(docker build --quiet - < Dockerfile)"

RUN="docker run --rm --mount type=bind,source=$PROJECT_DIR,target=/mnt $DOCKER_IMAGE_ID"

MODE=debug
if [ "$1" = "release" ]; then
    MODE=release
fi

echo "Building OpenSSL"
$RUN bash -c "
    source /root/emsdk/emsdk_env.sh && \
    cd /mnt/openssl && \
    emconfigure ./Configure linux-generic32 --cross-compile-prefix= --$MODE && \
    emmake make -j`nproc` build_generated libcrypto.a
"
