// Generated compositions are dedicated to CC0; see docs/media-music-license.md.
pub(super) fn instrumental(sunset: bool) -> Vec<u8> {
    const RATE: u32 = 22_050;
    const SECONDS: u32 = 16;
    let samples = RATE * SECONDS;
    let mut out = Vec::with_capacity(44 + samples as usize * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + samples * 2).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16_u32.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&1_u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2_u16.to_le_bytes());
    out.extend_from_slice(&16_u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(samples * 2).to_le_bytes());
    let roots = if sunset {
        [48.0_f32, 53.0, 57.0, 55.0]
    } else {
        [60.0_f32, 57.0, 53.0, 55.0]
    };
    for sample in 0..samples {
        let t = sample as f32 / RATE as f32;
        let chord = (t / 4.0) as usize;
        let root = roots[chord.min(3)];
        let mut signal = 0.0;
        for (i, interval) in [0.0, 4.0, 7.0].iter().enumerate() {
            let note = root + interval;
            let hz = 440.0 * 2.0_f32.powf((note - 69.0) / 12.0);
            let local = if sunset {
                t % 4.0
            } else {
                (t + i as f32 * 0.16) % 0.5
            };
            let envelope = if sunset {
                (local / 0.5).min(1.0) * ((4.0 - local) / 0.5).min(1.0)
            } else {
                (local / 0.015).min(1.0) * (-local * 7.0).exp()
            };
            signal += (std::f32::consts::TAU * hz * t).sin() * envelope / 3.0;
        }
        let value = (signal * 0.35 * i16::MAX as f32) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}
