#!/bin/sh
# AUTHORIZED_KEY: public key allowed to log in as `dev`.
# HIDE_GIT=1: start without git on PATH (moved to /opt/git-hidden; move it back to "install" git).
set -e
install -d -m 700 -o dev -g dev /home/dev/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/dev/.ssh/authorized_keys
chown dev:dev /home/dev/.ssh/authorized_keys
chmod 600 /home/dev/.ssh/authorized_keys
su dev -c 'git config --global user.name "AI Agent" && git config --global user.email ai@sandbox.invalid'
if [ "$HIDE_GIT" = "1" ]; then mv /usr/bin/git /opt/git-hidden; fi
ssh-keygen -A >/dev/null
exec /usr/sbin/sshd -D -e
