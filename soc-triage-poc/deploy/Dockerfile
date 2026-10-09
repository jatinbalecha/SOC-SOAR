# Hosting image: n8n 2.41.3 + Streamlit console in one container.
# Built automatically by Hugging Face Spaces (copied to the Space root by the packaging step).
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip build-essential curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g n8n@2.41.3 --no-audit --no-fund --loglevel=error

RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir streamlit requests pandas flask
ENV PATH=/opt/venv/bin:$PATH

# Hugging Face runs containers as uid 1000, which is the 'node' user in this image
USER node
ENV HOME=/home/node
WORKDIR /home/node/app
COPY --chown=node . .

EXPOSE 7860
CMD ["bash", "deploy/entrypoint.sh"]
