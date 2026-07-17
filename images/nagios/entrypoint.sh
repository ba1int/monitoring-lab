#!/bin/sh
set -eu

readonly nagios_cfg=/usr/local/nagios/etc/nagios.cfg
readonly nagios_pid=/run/nagios/nagios.pid
readonly private_key=/run/nagios-ssh/id_ed25519
readonly lab_ssh_key_source=${LAB_SSH_KEY_SOURCE:-/run/secrets/lab_ssh_key}

install -d -o nagios -g nagios -m 0755 /run/nagios
install -d -o nagios -g nagios -m 0700 /run/nagios-ssh

if [ ! -f "${lab_ssh_key_source}" ]; then
    printf 'ERROR: lab SSH private key is not mounted at %s\n' "${lab_ssh_key_source}" >&2
    exit 1
fi

# Never let Nagios or OpenSSH consume the bind-mounted key directly. The runtime
# copy has known ownership and permissions even when the host mount differs.
install -o nagios -g nagios -m 0600 "${lab_ssh_key_source}" "${private_key}"

htpasswd -b -c /usr/local/nagios/etc/htpasswd.users \
    nagiosadmin "${NAGIOSADMIN_PASSWORD:-monitoring-lab}" >/dev/null
chown root:www-data /usr/local/nagios/etc/htpasswd.users
chmod 0640 /usr/local/nagios/etc/htpasswd.users

rm -f "${nagios_pid}"
/usr/local/nagios/bin/nagios -v "${nagios_cfg}"
/usr/local/nagios/bin/nagios -d "${nagios_cfg}"

i=0
while [ ! -s "${nagios_pid}" ]; do
    i=$((i + 1))
    if [ "${i}" -ge 50 ]; then
        printf 'ERROR: Nagios did not create %s\n' "${nagios_pid}" >&2
        exit 1
    fi
    sleep 0.1
done

apache2ctl -D FOREGROUND &
apache_pid=$!

shutdown() {
    trap - INT TERM

    if kill -0 "${apache_pid}" 2>/dev/null; then
        kill -TERM "${apache_pid}" 2>/dev/null || true
    fi

    if [ -s "${nagios_pid}" ]; then
        nagios_process=$(cat "${nagios_pid}")
        kill -TERM "${nagios_process}" 2>/dev/null || true
    fi

    wait "${apache_pid}" 2>/dev/null || true
}

trap 'shutdown; exit 0' INT TERM

set +e
wait "${apache_pid}"
status=$?
set -e

shutdown
exit "${status}"
