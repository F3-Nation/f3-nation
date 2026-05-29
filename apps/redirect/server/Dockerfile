# Multi-stage build for the redirect tier (redirectd).
# Produces a small static binary on a distroless base.
FROM golang:1.26-alpine AS build
WORKDIR /src
# Cache deps first.
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/redirectd ./cmd/redirectd

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/redirectd /redirectd
# 80 for ACME HTTP-01 + plain redirects; 443 for TLS we terminate ourselves.
# Runs as root so it can bind the privileged ports 80/443 on the host network.
EXPOSE 80 443
ENTRYPOINT ["/redirectd"]
