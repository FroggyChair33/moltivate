import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Speech from 'expo-speech';
import { DEFAULT_SECONDS, PRESET_SECONDS, PrepCountdown, validSeconds } from './countdown.mjs';

/** Mount on a focused camera screen. See README for the recording adapter contract. */
export default function WorkoutPrep({ cameraReady, screenActive = true, onStartRecording,
  initialSeconds = DEFAULT_SECONDS, onDurationChange, onPhaseChange }) {
  const [seconds, setSeconds] = useState(validSeconds(initialSeconds) ? initialSeconds : DEFAULT_SECONDS);
  const [custom, setCustom] = useState(!PRESET_SECONDS.includes(initialSeconds));
  const [customText, setCustomText] = useState(String(seconds));
  const [sound, setSound] = useState(true);
  const [state, setState] = useState({ phase: 'idle', remaining: null, message: '' });
  const controller = useRef(null);
  const speechGeneration = useRef(0);
  const current = useRef({});
  current.current = { cameraReady, screenActive, onStartRecording, onPhaseChange };

  useEffect(() => {
    const c = new PrepCountdown({
      canStart: () => current.current.cameraReady && current.current.screenActive && AppState.currentState === 'active',
      onRecord: signal => current.current.onStartRecording(signal),
      onChange: next => { setState(next); current.current.onPhaseChange?.(next.phase); },
    });
    controller.current = c;
    const changed = AppState.addEventListener('change', value => {
      if (value !== 'active') c.cancel('Paused. Start again when you’re ready.');
    });
    const blurred = Platform.OS === 'android'
      ? AppState.addEventListener('blur', () => c.cancel('Paused. Start again when you’re ready.')) : null;
    return () => { c.dispose(); changed.remove(); blurred?.remove(); controller.current = null; };
  }, []);

  useEffect(() => {
    if (!cameraReady || !screenActive) controller.current?.cancel('Get the camera ready to start.');
  }, [cameraReady, screenActive]);

  useEffect(() => {
    const generation = ++speechGeneration.current;
    const words = state.phase === 'counting' ? String(state.remaining) : state.phase === 'recording' ? 'Go' : null;
    // Drop old queued speech so a slow voice cannot keep counting after capture begins.
    Speech.stop().then(() => {
      if (generation === speechGeneration.current && sound && words) {
        Speech.speak(words, { language: 'en-US', rate: 1.05 });
      }
    }).catch(() => {}); // Visual countdown remains available if speech fails.
    return () => { speechGeneration.current++; Speech.stop().catch(() => {}); };
  }, [state.phase, state.remaining, sound]);

  function choose(value) {
    setSeconds(value);
    if (validSeconds(value)) onDurationChange?.(value);
  }
  const idle = state.phase === 'idle' || state.phase === 'error';
  const ready = cameraReady && screenActive && validSeconds(seconds);

  return <View style={styles.panel}>
    {idle ? <>
      <Text style={styles.eyebrow}>YOUR SET, YOUR PACE</Text>
      <Text style={styles.heading}>Time to get ready.</Text>
      <Text style={styles.body}>Place your phone, step back, and get your whole body in view.</Text>
      <Text style={styles.label}>Start recording in</Text>
      <View style={styles.options}>
        {PRESET_SECONDS.map(value => <Pressable key={value} accessibilityRole="button"
          accessibilityLabel={`${value} seconds`} accessibilityState={{ selected: !custom && seconds === value }}
          onPress={() => { setCustom(false); choose(value); }}
          style={[styles.option, !custom && seconds === value && styles.selected]}>
          <Text style={[styles.optionText, !custom && seconds === value && styles.selectedText]}>{value}s</Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityState={{ selected: custom }}
          onPress={() => { setCustom(true); choose(Number(customText)); }} style={[styles.option, custom && styles.selected]}>
          <Text style={[styles.optionText, custom && styles.selectedText]}>Custom</Text>
        </Pressable>
      </View>
      {custom && <View style={styles.custom}>
        <TextInput value={customText} keyboardType="number-pad" maxLength={2}
          accessibilityLabel="Custom preparation time in seconds, 1 to 60" selectTextOnFocus
          onChangeText={value => { const digits = value.replace(/\D/g, ''); setCustomText(digits); choose(Number(digits)); }}
          style={styles.input} />
        <Text style={styles.body}>seconds · 1–60</Text>
      </View>}
      <View style={styles.sound}>
        <Text style={styles.label}>Spoken countdown</Text>
        <Switch value={sound} onValueChange={setSound} accessibilityLabel="Spoken countdown" trackColor={{ true: '#25563f' }} />
      </View>
      {sound && Platform.OS === 'ios' && <Text style={styles.hint}>Turn silent mode off to hear the countdown.</Text>}
      {!!state.message && <Text accessibilityLiveRegion="polite" style={styles.hint}>{state.message}</Text>}
      {!validSeconds(seconds) && <Text style={styles.hint}>Choose a whole number from 1 to 60.</Text>}
      <Pressable accessibilityRole="button" disabled={!ready} accessibilityState={{ disabled: !ready }}
        onPress={() => controller.current?.start(seconds)} style={[styles.start, !ready && styles.disabled]}>
        <Text style={styles.startText}>{cameraReady ? 'Get into position' : 'Waiting for camera…'}</Text>
      </Pressable>
    </> : <View style={styles.stage}>
      <Text style={styles.label}>{state.message}</Text>
      <Text accessibilityRole="text" accessibilityLiveRegion={sound ? 'none' : 'polite'} style={styles.number}>
        {state.phase === 'counting' ? state.remaining : state.phase === 'recording' ? 'Go!' : '…'}
      </Text>
      <Text style={styles.body}>{state.phase === 'counting' ? 'Recording starts after the countdown.'
        : state.phase === 'recording' ? 'Make your first rep count.' : 'Getting the camera ready.'}</Text>
      {state.phase !== 'recording' && <Pressable accessibilityRole="button" onPress={() => controller.current?.cancel()}
        style={styles.option}><Text style={styles.optionText}>Cancel</Text></Pressable>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#faf8f1', padding: 24, borderRadius: 24, gap: 12 },
  eyebrow: { color: '#37654c', fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  heading: { color: '#173e2d', fontSize: 30, fontWeight: '700' },
  body: { color: '#526458', fontSize: 16, lineHeight: 24 },
  label: { color: '#173e2d', fontSize: 16, fontWeight: '600' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 48, minWidth: 48, paddingHorizontal: 16, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#b9c6ba' },
  selected: { backgroundColor: '#173e2d', borderColor: '#173e2d' },
  optionText: { color: '#173e2d', fontSize: 16 }, selectedText: { color: '#fffdf5' },
  custom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { borderWidth: 1, borderColor: '#607c68', borderRadius: 12, padding: 12, width: 72, fontSize: 20, color: '#173e2d' },
  sound: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { color: '#765631', fontSize: 13, lineHeight: 20 },
  start: { minHeight: 54, borderRadius: 16, padding: 16, alignItems: 'center', backgroundColor: '#173e2d' },
  startText: { color: '#fffdf5', fontSize: 17, fontWeight: '700' }, disabled: { opacity: .45 },
  stage: { alignItems: 'center', gap: 20, paddingVertical: 24 },
  number: { color: '#173e2d', fontSize: 112, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
