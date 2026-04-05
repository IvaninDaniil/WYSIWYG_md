# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-builder
WORKDIR /workspace/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM rust:1.86-slim AS backend-builder
WORKDIR /workspace/backend
COPY backend/Cargo.toml ./
COPY backend/src ./src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
WORKDIR /app
COPY --from=backend-builder /workspace/backend/target/release/wysiwyg_md /app/wysiwyg_md
COPY --from=frontend-builder /workspace/frontend/dist /app/frontend/dist
COPY static /app/static
EXPOSE 7878
ENV HOST=0.0.0.0:7878
CMD ["/app/wysiwyg_md"]
