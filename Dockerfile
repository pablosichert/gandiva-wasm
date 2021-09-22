FROM ubuntu:latest

ARG DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-c"]

# Install OS packages
RUN apt-get update && \
    apt-get install -y git python3 cmake clang

# Create git directory
RUN cd ~ && \
    mkdir git

# Install Emscripten SDK
RUN cd ~/git && \
    git clone https://github.com/emscripten-core/emsdk && \
    cd ~/git/emsdk && \
    ./emsdk install latest && \
    ./emsdk activate latest

# Build OpenSSL
RUN cd ~/git && \
    git clone https://github.com/openssl/openssl && \
    cd ~/git/openssl && \
    source ~/git/emsdk/emsdk_env.sh && \
    emconfigure ./Configure no-legacy linux-generic64 && \
    sed -i 's|^CROSS_COMPILE.*$|CROSS_COMPILE=|g' Makefile && \
    emmake make -j`nproc` build_generated libcrypto.a

# Build LLVM
RUN cd ~/git && \
    git clone -b wasm https://github.com/pablosichert/llvm-project && \
    cd ~/git/llvm-project/llvm && \
    source ~/git/emsdk/emsdk_env.sh && \
    mkdir build && \
    cd build && \
    mkdir native && \
    cd native && \
    cmake ../.. && \
    make llvm-tblgen llvm-link && \
    cd .. && \
    mkdir wasm && \
    cd wasm && \
    emcmake cmake \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_CROSSCOMPILING=True \
        -DLLVM_TABLEGEN=~/git/llvm-project/llvm/build/native/bin/llvm-tblgen \
        -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten \
        -DLLVM_TARGET_ARCH=wasm32 \
        -DLLVM_TARGETS_TO_BUILD=WebAssembly \
        ../.. && \
    emmake make -j`nproc` LLVMCore LLVMMCJIT LLVMipo LLVMBitReader LLVMTarget LLVMLinker LLVMAnalysis LLVMDebugInfoDWARF LLVMWebAssemblyCodeGen LLVMWebAssemblyAsmParser LLVMWebAssemblyDisassembler

# Build Gandiva
RUN cd ~/git && \
    git clone -b gandiva-wasm https://github.com/pablosichert/arrow && \
    cd ~/git/arrow && \
    source ~/git/emsdk/emsdk_env.sh && \
    cd cpp && \
    mkdir build && \
    cd build && \
    emcmake cmake \
        -DCMAKE_BUILD_TYPE=Release \
        -DARROW_GANDIVA=ON \
        -DLLVM_DIR=~/git/llvm-project/llvm/build/wasm/lib/cmake/llvm \
        -DLLVM_TOOLS_BINARY_DIR=~/git/llvm-project/llvm/build/wasm/lib/cmake/llvm \
        -DCLANG_EXECUTABLE=~/git/emsdk/upstream/emscripten/emcc \
        -DLLVM_LINK_EXECUTABLE=~/git/llvm-project/llvm/build/native/bin/llvm-link \
        -DGANDIVA_OPENSSL_LIBS="OpenSSL::Crypto" \
        -DOPENSSL_INCLUDE_DIR=~/git/openssl/include \
        -DOPENSSL_CRYPTO_LIBRARY=~/git/openssl/libcrypto.a \
        -DARROW_JEMALLOC=OFF \
        -DARROW_CPU_FLAG= \
        .. && \
    emmake make -j`nproc` gandiva_wasm
