PROJECT_DIR="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)"
DOCKER_IMAGE_ID="$(docker build --quiet - < Dockerfile)"

RUN="docker run --rm --mount type=bind,source=$PROJECT_DIR,target=/mnt $DOCKER_IMAGE_ID"

MODE=debug
CMAKE_BUILD_TYPE=Debug
if [ "$1" = "release" ]; then
    MODE=release
    CMAKE_BUILD_TYPE=Release
fi

echo "Building LLVM"
$RUN bash -c "
    source /root/emsdk/emsdk_env.sh && \
    mkdir -p /mnt/llvm-project/llvm/build/native && \
    cd /mnt/llvm-project/llvm/build/native && \
    cmake ../.. && \
    make -j`nproc` llvm-tblgen llvm-link && \
    mkdir -p /mnt/llvm-project/llvm/build/wasm/$MODE && \
    cd /mnt/llvm-project/llvm/build/wasm/$MODE && \
    emcmake cmake \
        -DCMAKE_BUILD_TYPE=$CMAKE_BUILD_TYPE \
        -DCMAKE_CROSSCOMPILING=True \
        -DLLVM_TABLEGEN=/mnt/llvm-project/llvm/build/native/bin/llvm-tblgen \
        -DLLVM_HOST_TRIPLE=wasm32-unknown-unknown-wasm \
        -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-unknown-wasm \
        -DLLVM_TARGET_ARCH=wasm32 \
        -DLLVM_TARGETS_TO_BUILD=WebAssembly \
        ../../.. && \
    emmake make -j`nproc` LLVMCore LLVMMCJIT LLVMipo LLVMBitReader LLVMTarget LLVMLinker LLVMAnalysis LLVMDebugInfoDWARF LLVMWebAssemblyCodeGen LLVMWebAssemblyAsmParser LLVMWebAssemblyDisassembler
"
