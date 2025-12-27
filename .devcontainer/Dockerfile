ARG NODE_VERSION=20.19.0

FROM node:${NODE_VERSION}-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    sudo \
  && rm -rf /var/lib/apt/lists/*

RUN echo "node ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node

ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /workspaces/f3-nation

RUN corepack enable \
  && corepack prepare pnpm@8.15.1 --activate

USER node
