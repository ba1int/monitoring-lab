FROM icinga/icinga2:2.16.4

# Icinga's official 2.16.4 image already contains monitoring-plugins and
# openssh-client. Fail the build if that contract changes under this pin.
RUN test -x /usr/lib/nagios/plugins/check_ssh \
    && test -x /usr/lib/nagios/plugins/check_by_ssh \
    && command -v ssh >/dev/null

USER root
COPY check_by_ssh_lab /usr/local/libexec/check_by_ssh_lab
RUN chmod 0755 /usr/local/libexec/check_by_ssh_lab
USER icinga
