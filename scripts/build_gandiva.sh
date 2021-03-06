PROJECT_DIR="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)"
DOCKER_IMAGE_ID="$(docker build --quiet - < Dockerfile)"

RUN="docker run --rm --mount type=bind,source=$PROJECT_DIR,target=/mnt $DOCKER_IMAGE_ID"

MODE=debug
CMAKE_BUILD_TYPE=Debug
if [ "$1" = "release" ]; then
    MODE=release
    CMAKE_BUILD_TYPE=Release
fi

echo "Building Gandiva"
$RUN bash -c "
    source /root/emsdk/emsdk_env.sh && \
    mkdir -p /mnt/arrow/cpp/build/$MODE && \
    cd /mnt/arrow/cpp/build/$MODE && \
    emcmake cmake \
        -DCMAKE_BUILD_TYPE=$CMAKE_BUILD_TYPE \
        -DARROW_GANDIVA=ON \
        -DLLVM_DIR=/mnt/llvm-project/llvm/build/wasm/$MODE/lib/cmake/llvm \
        -DLLVM_TOOLS_BINARY_DIR=/mnt/llvm-project/llvm/build/wasm/$MODE/lib/cmake/llvm \
        -DCLANG_EXECUTABLE=/root/emsdk/upstream/emscripten/emcc \
        -DLLVM_LINK_EXECUTABLE=/mnt/llvm-project/llvm/build/native/bin/llvm-link \
        -DGANDIVA_OPENSSL_LIBS=OpenSSL::Crypto \
        -DOPENSSL_INCLUDE_DIR=/mnt/openssl/include \
        -DOPENSSL_CRYPTO_LIBRARY=/mnt/openssl/libcrypto.a \
        -DARROW_JEMALLOC=OFF \
        -DARROW_CPU_FLAG= \
        ../.. && \
    emmake make -j`nproc` gandiva_wasm && \
    sed -i -- 's/\"dlopen\":\s*_dlopen/\"dlopen\":()=>-1/g' $MODE/gandiva_wasm.js && \
    sed -i -- 's/\"dlclose\":\s*_dlclose/\"dlclose\":()=>0/g' $MODE/gandiva_wasm.js
"
