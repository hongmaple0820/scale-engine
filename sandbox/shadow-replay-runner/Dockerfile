# The build workflow records the resolved image digest. Production adapter configuration
# must use that digest, never this mutable build tag.
FROM python:3.13-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN addgroup -S -g 65532 runner \
    && adduser -S -D -H -u 65532 -G runner runner \
    && mkdir -p /inputs \
    && chown 65532:65532 /inputs

COPY --chown=65532:65532 runner.py /usr/local/bin/scale-shadow-replay
RUN chmod 0555 /usr/local/bin/scale-shadow-replay

USER 65532:65532
WORKDIR /tmp
ENTRYPOINT ["/usr/local/bin/scale-shadow-replay"]
