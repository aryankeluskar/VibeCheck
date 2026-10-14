#!/bin/bash
# adb for MQDH's casting app that only sees the headset's Wi-Fi connection
# ($QUEST_WIFI), so the cast stays wireless even while the headset is also
# plugged in over USB ($QUEST_USB). `node scripts/quest-drive.mjs cast` sets
# QUEST_WIFI, QUEST_USB and REAL_ADB.
export ANDROID_SERIAL="$QUEST_WIFI"
args=()
for a in "$@"; do
  [ -n "$QUEST_USB" ] && [ "$a" = "$QUEST_USB" ] && a="$QUEST_WIFI"
  args+=("$a")
done
if [ "$1" = devices ] && [ -n "$QUEST_USB" ]; then
  "$REAL_ADB" "${args[@]}" | grep -v "^$QUEST_USB"
else
  exec "$REAL_ADB" "${args[@]}"
fi
