/** Fake key material. Never real keys (plan §9 S10); shaped like the real thing so redaction is exercised. */
export const FAKE_MGMT_KEY = `sk-or-mgmt-FAKE${"a1b2c3d4".repeat(7)}`;
export const FAKE_USER_KEY = `sk-or-v1-FAKE${"0e6f1c96".repeat(8)}`;
export const FAKE_NEW_KEY = `sk-or-v1-FAKENEW${"deadbeef".repeat(7)}`;
export const FAKE_OTHER_MGMT_KEY = `sk-or-mgmt-FAKEOTHER${"99887766".repeat(6)}`;

export const ALL_FAKE_KEYS = [FAKE_MGMT_KEY, FAKE_USER_KEY, FAKE_NEW_KEY, FAKE_OTHER_MGMT_KEY];
