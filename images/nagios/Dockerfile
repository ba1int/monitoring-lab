ARG DEBIAN_VERSION=13-slim

FROM debian:${DEBIAN_VERSION} AS builder

ARG NAGIOS_CORE_VERSION=4.5.13
ARG NAGIOS_PLUGINS_VERSION=2.5

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        autoconf \
        automake \
        build-essential \
        ca-certificates \
        curl \
        file \
        gettext \
        libgd-dev \
        libssl-dev \
        openssh-client \
        pkg-config \
        procps \
        unzip \
    && groupadd --system nagios \
    && useradd --system --gid nagios --home-dir /usr/local/nagios --shell /usr/sbin/nologin nagios \
    && groupadd --system nagcmd \
    && usermod -aG nagcmd nagios \
    && install -d /usr/src/nagios-core /usr/src/nagios-plugins \
    && curl --fail --show-error --location --retry 3 \
        "https://github.com/NagiosEnterprises/nagioscore/releases/download/nagios-${NAGIOS_CORE_VERSION}/nagios-${NAGIOS_CORE_VERSION}.tar.gz" \
        -o /tmp/nagios-core.tar.gz \
    && tar --extract --gzip --file /tmp/nagios-core.tar.gz --directory /usr/src/nagios-core --strip-components=1 \
    && cd /usr/src/nagios-core \
    && ./configure \
        --prefix=/usr/local/nagios \
        --with-nagios-user=nagios \
        --with-nagios-group=nagios \
        --with-command-group=nagcmd \
    && make -j"$(nproc)" all \
    && make install \
    && make install-commandmode \
    && make install-config \
    && make install-exfoliation \
    && curl --fail --show-error --location --retry 3 \
        "https://github.com/nagios-plugins/nagios-plugins/releases/download/release-${NAGIOS_PLUGINS_VERSION}/nagios-plugins-${NAGIOS_PLUGINS_VERSION}.tar.gz" \
        -o /tmp/nagios-plugins.tar.gz \
    && tar --extract --gzip --file /tmp/nagios-plugins.tar.gz --directory /usr/src/nagios-plugins --strip-components=1 \
    && cd /usr/src/nagios-plugins \
    && ./configure \
        --prefix=/usr/local/nagios \
        --with-nagios-user=nagios \
        --with-nagios-group=nagios \
        --with-openssl \
    && make -j"$(nproc)" \
    && make install \
    && test -x /usr/local/nagios/bin/nagios \
    && test -x /usr/local/nagios/libexec/check_ssh \
    && test -x /usr/local/nagios/libexec/check_by_ssh \
    && rm -rf /tmp/nagios-core.tar.gz /tmp/nagios-plugins.tar.gz /usr/src/nagios-core /usr/src/nagios-plugins /var/lib/apt/lists/*

FROM debian:${DEBIAN_VERSION}

ARG NAGIOS_CORE_VERSION=4.5.13
ARG NAGIOS_PLUGINS_VERSION=2.5

LABEL org.opencontainers.image.title="Monitoring Lab Nagios Core" \
      org.opencontainers.image.description="Native multi-architecture Nagios Core lab image built from official pinned sources" \
      org.opencontainers.image.version="${NAGIOS_CORE_VERSION}" \
      org.opencontainers.image.source="https://github.com/NagiosEnterprises/nagioscore"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        apache2 \
        apache2-utils \
        ca-certificates \
        curl \
        libgd3 \
        libssl3t64 \
        openssh-client \
        procps \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system nagios \
    && useradd --system --gid nagios --home-dir /usr/local/nagios --shell /usr/sbin/nologin nagios \
    && groupadd --system nagcmd \
    && usermod -aG nagcmd nagios \
    && usermod -aG nagcmd www-data \
    && a2dismod mpm_event \
    && a2enmod mpm_prefork \
    && a2enmod cgi \
    && rm -f /etc/apache2/sites-enabled/000-default.conf /var/www/html/index.html

COPY --from=builder --chown=nagios:nagios /usr/local/nagios /usr/local/nagios
COPY config/nagios/apache.conf /etc/apache2/conf-available/nagios.conf
COPY config/nagios/cgi.cfg /usr/local/nagios/etc/cgi.cfg
COPY config/nagios/nagios.cfg /usr/local/nagios/etc/nagios.cfg
COPY config/nagios/resource.cfg /usr/local/nagios/etc/resource.cfg
COPY config/nagios/objects /usr/local/nagios/etc/objects
COPY images/nagios/entrypoint.sh /usr/local/bin/nagios-entrypoint

RUN chmod 0755 /usr/local/bin/nagios-entrypoint \
    && a2enconf nagios \
    && install -d -o nagios -g nagios -m 0755 \
        /usr/local/nagios/var \
        /usr/local/nagios/var/archives \
        /usr/local/nagios/var/spool/checkresults \
    && install -d -o nagios -g nagcmd -m 2770 /usr/local/nagios/var/rw \
    && chown -R nagios:nagios /usr/local/nagios/etc \
    && chmod 0640 /usr/local/nagios/etc/resource.cfg \
    && /usr/local/nagios/bin/nagios -v /usr/local/nagios/etc/nagios.cfg

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=25s --retries=6 \
    CMD test -s /run/nagios/nagios.pid \
      && kill -0 "$(cat /run/nagios/nagios.pid)" \
      && curl --fail --silent --show-error \
        --user "nagiosadmin:${NAGIOSADMIN_PASSWORD:-monitoring-lab}" \
        "http://127.0.0.1/nagios/cgi-bin/statusjson.cgi?query=programstatus" >/dev/null \
      || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nagios-entrypoint"]
