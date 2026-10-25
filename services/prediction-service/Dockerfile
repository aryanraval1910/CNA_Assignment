# Multi-stage Dockerfile for C++17 ETA and Risk Prediction Service
FROM alpine:3.19 AS builder

RUN apk add --no-cache build-base cmake linux-headers

WORKDIR /build

COPY CMakeLists.txt ./
COPY include/ ./include/
COPY src/ ./src/
COPY tests/ ./tests/

RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release \
    && ./build/test_prediction

FROM alpine:3.19 AS runner

RUN apk add --no-cache libstdc++ libgcc
RUN addgroup -S appgroup && adduser -S -D -H -G appgroup appuser

WORKDIR /app
COPY --from=builder /build/build/prediction_service /app/prediction_service
RUN chown appuser:appgroup /app/prediction_service

USER appuser

EXPOSE 3004

ENV PORT=3004 \
    SHIPMENT_SERVICE_HOST=shipment-service \
    SHIPMENT_SERVICE_PORT=3002 \
    TRACKING_SERVICE_HOST=tracking-service \
    TRACKING_SERVICE_PORT=3003

CMD ["/app/prediction_service"]
