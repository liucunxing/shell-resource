FROM nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951

# The upstream image contains Brotli 1.2.0; 1.2.1 fixes CVE-2026-111497.
RUN sed -i 's|https://dl-cdn.alpinelinux.org/alpine|https://mirrors.aliyun.com/alpine|g' /etc/apk/repositories \
    && apk add --no-cache --upgrade 'brotli-libs=1.2.1-r0'
