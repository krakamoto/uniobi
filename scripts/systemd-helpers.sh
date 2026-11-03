#!/usr/bin/env bash
# Helper condivisi per controllare la unit utente uniai.service.
# In alcune sandbox `systemctl --user` non riesce a usare il socket privato,
# mentre `busctl --user` raggiunge correttamente il manager utente.

UNIAI_SYSTEMD_UNIT="${UNIAI_SYSTEMD_UNIT:-uniai.service}"

uniai_systemd_installed() {
  local state
  state="$(busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager GetUnitFileState s "$UNIAI_SYSTEMD_UNIT" 2>/dev/null \
    | sed -n 's/^s "//; s/"$//p')"
  if [ -n "$state" ] && [ "$state" != "not-found" ]; then
    return 0
  fi
  systemctl --user cat "$UNIAI_SYSTEMD_UNIT" >/dev/null 2>&1
}

uniai_systemd_loaded() {
  uniai_systemd_installed \
    || busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
      org.freedesktop.systemd1.Manager GetUnit s "$UNIAI_SYSTEMD_UNIT" >/dev/null 2>&1
}

uniai_systemd_active() {
  local state
  state="$(busctl --user get-property org.freedesktop.systemd1 \
    "/org/freedesktop/systemd1/unit/${UNIAI_SYSTEMD_UNIT//./_2e}" \
    org.freedesktop.systemd1.Unit ActiveState 2>/dev/null | awk '{print $2}' | tr -d '"')"
  if [ -z "$state" ]; then
    state="$(systemctl --user is-active "$UNIAI_SYSTEMD_UNIT" 2>/dev/null || true)"
  fi
  [ "$state" = "active" ]
}

uniai_systemd_start() {
  busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager StartUnit ss "$UNIAI_SYSTEMD_UNIT" replace >/dev/null 2>&1 \
    || systemctl --user start "$UNIAI_SYSTEMD_UNIT"
}

uniai_systemd_stop() {
  busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    org.freedesktop.systemd1.Manager StopUnit ss "$UNIAI_SYSTEMD_UNIT" replace >/dev/null 2>&1 \
    || systemctl --user stop "$UNIAI_SYSTEMD_UNIT"
}
