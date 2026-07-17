FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TARGETARCH
ARG NEOVIM_VERSION=0.12.4
ARG ZELLIJ_VERSION=0.44.3
ARG FZF_VERSION=0.72.0
ARG FZF_COMMIT=6fefe025461b168eac2546ccba3403b70eb5da16
ARG FZF_VIM_COMMIT=d2a59a992a2455f609c0fde2ebd84427ea8f919a

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        bash-completion \
        bat \
        ca-certificates \
        curl \
        git \
        iproute2 \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        tini \
        util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/batcat /usr/local/bin/bat

RUN set -eux; \
    case "$TARGETARCH" in \
        amd64) \
            nvim_arch='x86_64'; \
            nvim_sha='012bf3fcac5ade43914df3f174668bf64d05e049a4f032a388c027b1ebd78628'; \
            zellij_arch='x86_64'; \
            zellij_sha='0f7c346788627f506c0a28296517768633cff24fc822a739f8264b640ecad751'; \
            fzf_arch='amd64'; \
            fzf_sha='0e58e4bd0b3c5d68c56b54c460a6863d0de79633ed18d388575a960ab447b006'; \
            ;; \
        arm64) \
            nvim_arch='arm64'; \
            nvim_sha='ceb7e88c6b681f0515d135dcdfad54f5eb4373b25ce6172197cd9a69c758063f'; \
            zellij_arch='aarch64'; \
            zellij_sha='15e6534d42644d66973d136c590c49739dcfd6a1a2a0d3d917973f16c81b45fb'; \
            fzf_arch='arm64'; \
            fzf_sha='a0a5b50730f568c5f08b8dbba1e6e598db253e1856d371290086786b889b996b'; \
            ;; \
        *) \
            printf 'unsupported TARGETARCH: %s\n' "$TARGETARCH" >&2; \
            exit 1; \
            ;; \
    esac; \
    curl -fsSLo /tmp/nvim.tar.gz \
        "https://github.com/neovim/neovim/releases/download/v${NEOVIM_VERSION}/nvim-linux-${nvim_arch}.tar.gz"; \
    printf '%s  %s\n' "$nvim_sha" /tmp/nvim.tar.gz | sha256sum -c -; \
    install -d /opt/nvim; \
    tar -xzf /tmp/nvim.tar.gz --strip-components=1 -C /opt/nvim; \
    ln -s /opt/nvim/bin/nvim /usr/local/bin/nvim; \
    curl -fsSLo /tmp/zellij.tar.gz \
        "https://github.com/zellij-org/zellij/releases/download/v${ZELLIJ_VERSION}/zellij-${zellij_arch}-unknown-linux-musl.tar.gz"; \
    printf '%s  %s\n' "$zellij_sha" /tmp/zellij.tar.gz | sha256sum -c -; \
    tar -xzf /tmp/zellij.tar.gz -C /usr/local/bin zellij; \
    chmod 0755 /usr/local/bin/zellij; \
    curl -fsSLo /tmp/fzf.tar.gz \
        "https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-linux_${fzf_arch}.tar.gz"; \
    printf '%s  %s\n' "$fzf_sha" /tmp/fzf.tar.gz | sha256sum -c -; \
    tar -xzf /tmp/fzf.tar.gz -C /usr/local/bin fzf; \
    chmod 0755 /usr/local/bin/fzf; \
    rm -f /tmp/nvim.tar.gz /tmp/zellij.tar.gz /tmp/fzf.tar.gz

RUN set -eux; \
    git clone --filter=blob:none --no-checkout \
        https://github.com/junegunn/fzf.git \
        /usr/local/share/nvim/site/pack/fzf/start/fzf; \
    git -C /usr/local/share/nvim/site/pack/fzf/start/fzf checkout --detach "$FZF_COMMIT"; \
    git clone --filter=blob:none --no-checkout \
        https://github.com/junegunn/fzf.vim.git \
        /usr/local/share/nvim/site/pack/fzf/start/fzf.vim; \
    git -C /usr/local/share/nvim/site/pack/fzf/start/fzf.vim checkout --detach "$FZF_VIM_COMMIT"; \
    rm -rf \
        /usr/local/share/nvim/site/pack/fzf/start/fzf/.git \
        /usr/local/share/nvim/site/pack/fzf/start/fzf.vim/.git

RUN set -eux; \
    if ! getent group operator >/dev/null; then \
        if getent group 1000 >/dev/null; then \
            groupadd operator; \
        else \
            groupadd --gid 1000 operator; \
        fi; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != operator ]; then \
        usermod \
            --login operator \
            --home /home/operator \
            --move-home \
            --gid operator \
            --password '*' \
            --shell /bin/bash \
            "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
        useradd \
            --create-home \
            --home-dir /home/operator \
            --gid operator \
            --password '*' \
            --shell /bin/bash \
            --uid 1000 \
            operator; \
    fi; \
    install -d -o operator -g operator -m 0755 \
        /home/operator/.config \
        /home/operator/.cache \
        /home/operator/.local \
        /home/operator/.local/bin \
        /home/operator/.local/share \
        /home/operator/.local/state \
        /home/operator/.ssh

COPY workstation-entrypoint /usr/local/bin/workstation-entrypoint
COPY workstation-healthcheck /usr/local/bin/workstation-healthcheck
COPY enter-lab /usr/local/bin/enter-lab
COPY lab-shell /usr/local/bin/lab-shell

RUN chmod 0755 \
        /usr/local/bin/workstation-entrypoint \
        /usr/local/bin/workstation-healthcheck \
        /usr/local/bin/enter-lab \
        /usr/local/bin/lab-shell

ENV HOME=/home/operator \
    USER=operator \
    LOGNAME=operator \
    SHELL=/bin/bash \
    XDG_CONFIG_HOME=/home/operator/.config \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color \
    COLORTERM=truecolor \
    EDITOR=nvim \
    VISUAL=nvim \
    LAB_ISOLATED=1

USER operator
WORKDIR /home/operator

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
    CMD ["/usr/local/bin/workstation-healthcheck"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/workstation-entrypoint"]
CMD ["sleep", "infinity"]
