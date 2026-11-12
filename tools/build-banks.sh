#!/usr/bin/env bash
# Reconstruit les banques de sons embarquées (public/banks) à partir de leurs sources libres.
#   Instruments : FluidR3_GM (Frank Wen), licence CC BY 3.0, via github.com/gleitz/midi-js-soundfonts
#   Batterie    : Virtuosity Drums (Versilian Studios), licence CC0, via github.com/sfzinstruments/virtuosity_drums
# Nécessite curl et ffmpeg. Les fichiers produits sont versionnés : ce script ne sert qu'à les régénérer.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/banks; TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
GM=https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM
VD=https://raw.githubusercontent.com/sfzinstruments/virtuosity_drums/master/Samples
NAMES=(C Db D Eb E F Gb G Ab A Bb B)

# Une note tous les trois demi-tons, de do1 à do7 : les notes intermédiaires sont obtenues par transposition.
for inst in acoustic_grand_piano acoustic_guitar_nylon electric_guitar_clean electric_bass_finger acoustic_bass string_ensemble_1 cello brass_section tenor_sax flute choir_aahs; do
  mkdir -p "$OUT/$inst"
  for midi in $(seq 24 3 96); do
    name="${NAMES[$((midi % 12))]}$((midi / 12 - 1))"
    [ -s "$OUT/$inst/$midi.mp3" ] || curl -fsS --retry 3 -o "$OUT/$inst/$midi.mp3" "$GM/$inst-mp3/$name.mp3"
  done
  echo "$inst : $(ls "$OUT/$inst" | wc -l) notes"
done

# Batterie : un fichier par pad (0 à 15), en mono, raccourci et ramené au même niveau de crête.
DRUMS=(
  "kickmic/kick/kickmic_kick_snon_vl4_rr1.flac"      # 0 kick
  "oh/snare/oh_snare_center_vl36.flac"               # 1 caisse claire
  "oh/snare/oh_snare_rimshot_vl12.flac"              # 2 rimshot (à la place du clap)
  "oh/hh/oh_hh_closed_vl4_rr1.flac"                  # 3 charley fermé
  "oh/hh/oh_hh_open_vl4_rr1.flac"                    # 4 charley ouvert
  "oh/ltom/oh_ltom_center_vl16.flac"                 # 5 tom basse
  "oh/snare/oh_snare_crossstick_vl16.flac"           # 6 cross-stick
  "perc/close/cowbell/Cowbell1_Normal_v3_rr1_Close.wav" # 7 cloche
  "kickmic/kick/kickmic_kick_snoff_vl4_rr1.flac"     # 8 kick mat
  "oh/snare/oh_snare_muted_vl16.flac"                # 9 caisse claire étouffée
  "oh/htom/oh_htom_offcenter_vl16.flac"              # 10 tom médium
  "oh/htom/oh_htom_center_vl16.flac"                 # 11 tom aigu
  "perc/close/shaker/LShaker_Shake1D_rr1_Close.wav"  # 12 shaker
  "oh/crash/oh_crash_crash_vl3_rr1.flac"             # 13 crash
  "oh/ride/oh_ride_ride_vl3_rr1.flac"                # 14 ride
  "perc/close/conga/Conga_22_HitN_101_127_rr1_Close.wav" # 15 conga
)
mkdir -p "$OUT/drums"
for i in "${!DRUMS[@]}"; do
  src="${DRUMS[$i]}"; raw="$TMP/$i.${src##*.}"
  curl -fsS --retry 3 -o "$raw" "$VD/$src"
  peak=$(ffmpeg -hide_banner -i "$raw" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB/\1/p')
  gain=$(awk -v p="$peak" 'BEGIN { printf "%.1f", -1.5 - p }')
  ffmpeg -hide_banner -loglevel error -y -i "$raw" -ac 1 -ar 44100 -t 3.5 -af "volume=${gain}dB,afade=t=out:st=3.0:d=0.5" -codec:a libmp3lame -b:a 128k "$OUT/drums/$i.mp3"
done
echo "batterie : $(ls "$OUT/drums" | wc -l) sons"
cat > "$OUT/CREDITS.txt" <<'TXT'
Sons embarqués dans KH Music Pro

Instruments : FluidR3_GM, par Frank Wen. Licence Creative Commons Attribution 3.0
  (https://creativecommons.org/licenses/by/3.0/), fichiers préparés par le projet midi-js-soundfonts
  (https://github.com/gleitz/midi-js-soundfonts).

Batterie acoustique : Virtuosity Drums, par Versilian Studios. Licence CC0 1.0 (domaine public)
  (https://github.com/sfzinstruments/virtuosity_drums). Les sons ont été convertis en mono et normalisés.
TXT
du -sh "$OUT"
