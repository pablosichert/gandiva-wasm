FROM ubuntu:latest

ARG DEBIAN_FRONTEND=noninteractive

SHELL ["/bin/bash", "-c"]

# Install OS packages
RUN apt-get update && \
    apt-get install -y git python3 cmake clang

# Install Emscripten SDK
ARG EMSDK_REF=2.0.30
RUN cd /root && \
    git clone https://github.com/emscripten-core/emsdk && \
    cd /root/emsdk && \
    git checkout ${EMSDK_REF} && \
    ./emsdk install latest && \
    ./emsdk activate latest
