# Staging image for the homepage: nginx serving the prebuilt static export.
#
# The export is built on the runner by .github/workflows/deploy-homepage-staging.yml
# (NEXT_PUBLIC_CHANNEL=staging is inlined at build time) and handed in as the
# `site` build context, so this image never runs Node:
#
#   docker build --file apps/homepage/cloudrun/Dockerfile \
#     --build-context site=apps/homepage/out apps/homepage/cloudrun
#
# Prod is not built from this file; it is served by GitHub Pages.
#
# Pulled from GHCR (the nginx project's own mirror of the Docker Hub image,
# same digest) to stay clear of Docker Hub's shared unauthenticated rate limit.
FROM ghcr.io/nginx/nginx-unprivileged:1.30.3-alpine3.23@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2

COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=site . /usr/share/nginx/html

EXPOSE 8080
