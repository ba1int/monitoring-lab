FROM debian:trixie-slim

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        openssh-client \
        openssh-server \
        passwd \
        python3 \
        tini \
        util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN useradd \
        --create-home \
        --home-dir /home/operator \
        --gid operator \
        --password '*' \
        --shell /bin/bash \
        --uid 1000 \
        operator \
    && install -d -o root -g root -m 0755 /run/sshd /run/lab-ssh \
    && install -d -o operator -g operator -m 0750 /state \
    && install -d -o root -g root -m 0755 /usr/local/libexec \
    && rm -f /etc/ssh/ssh_host_*

COPY lab-entrypoint /usr/local/sbin/lab-entrypoint
COPY lab-healthcheck /usr/local/sbin/lab-healthcheck
COPY middleware_server.py /usr/local/libexec/lab-middleware-server
COPY check_lab_middleware /usr/local/libexec/check_lab_middleware

RUN chmod 0755 \
        /usr/local/sbin/lab-entrypoint \
        /usr/local/sbin/lab-healthcheck \
        /usr/local/libexec/lab-middleware-server \
        /usr/local/libexec/check_lab_middleware

EXPOSE 22 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
    CMD ["/usr/local/sbin/lab-healthcheck"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/sbin/lab-entrypoint"]
