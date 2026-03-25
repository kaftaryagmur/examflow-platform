FROM jenkins/jenkins:lts

USER root

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    apt-transport-https \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list && \
    apt-get update && apt-get install -y google-cloud-cli kubectl google-cloud-sdk-gke-gcloud-auth-plugin && \
    rm -rf /var/lib/apt/lists/*

USER jenkins