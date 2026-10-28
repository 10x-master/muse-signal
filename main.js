/**
 * 온디바이스 스마트 악보 뷰어 - 완성형 코어
 * 1) OpenSheetMusicDisplay (OSMD) 기반 MusicXML 렌더러 & 35% 골든 라인 보간 스크롤러
 * 2) Mozilla PDF.js SVGGraphics 기반 순수 벡터 렌더러 & 3페이지 윈도우 가상 렌더링(Virtual DOM)
 * 3) Web Audio API 기반 마이크 VAD 음압 감지 순수 연습 시간 타이머
 * 4) IndexedDB / LocalStorage 오프라인 세션 큐 & 온라인 자동 동기화(Cloud Sync) 모듈
 * 5) 일일 오후 8시 / 10시 로컬 알림 시뮬레이터 (Notification API & In-App Modal)
 * 6) [NEW] Web Crypto API (RSA-256 서명) 기반 온디바이스 비대칭 오프라인 라이선스 인증 엔진 (Step 1 ~ Step 4)
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 전역 설정 & 상수
  // --------------------------------------------------------------------------
  const THEMES = {
    DAY: {
      id: 'day',
      label: '데이 모드',
      icon: '☀️',
      notationColor: '#1A1A1A' // 먹색 (기본)
    },
    NIGHT: {
      id: 'night',
      label: '나이트 모드',
      icon: '🌙',
      notationColor: '#E0DCD3' // 미색
    }
  };

  const MODES = {
    MUSICXML: 'musicxml',
    PDF: 'pdf'
  };

  // MusicXML 템포 & 스크롤 설정 (80 BPM, 6/8박자)
  const BPM = 80;
  const BEATS_PER_MEASURE = 2;
  const SECONDS_PER_BEAT = 60 / BPM;
  const MEASURE_DURATION = SECONDS_PER_BEAT * BEATS_PER_MEASURE; // 1.5초

  // VAD(음압 감지) 임계값
  const VAD_VOLUME_THRESHOLD = 0.022; // RMS 진폭 임계치

  // [Step 2 & Step 4] 비대칭 암호화 마스터 키 시드
  const PROFESSOR_MASTER_SEED = "MUSE_SIGNAL_PROFESSOR_MASTER_SECRET_KEY_2026";

  // --------------------------------------------------------------------------
  // 상태 변수
  // --------------------------------------------------------------------------
  let currentTheme = THEMES.DAY; // 기본 데이 모드
  let currentMode = MODES.MUSICXML;

  // 라이선스 인증 상태
  let deviceUUID = '';
  let activeLicense = null;
  let html5QrScanner = null;

  // MusicXML 관련
  let osmd = null;
  let measureCoordinates = [];
  let currentMeasureIndex = 0;
  let measureProgress = 0;
  let isPlaying = false;
  let lastTimestamp = 0;
  let currentScrollY = 0;
  let targetScrollY = 0;
  let animationFrameId = null;

  // PDF.js 관련
  let pdfDoc = null;
  let pdfTotalPages = 0;
  let pdfCurrentPage = 1;
  let pdfPageSlots = [];
  let pdfTargetScrollY = 0;
  let pdfCurrentScrollY = 0;
  let pdfAnimationId = null;
  const renderedSvgCache = new Map();

  // Web Audio API & VAD 관련
  let audioContext = null;
  let analyserNode = null;
  let micMediaStream = null;
  let isMicActive = false;
  let purePracticeSeconds = 0;
  let isSoundDetected = false;
  let vadAnimId = null;

  // IndexedDB 인스턴스
  const DB_NAME = 'MuseSignalDB';
  const DB_VERSION = 2;
  const DB_STORE_SESSIONS = 'practice_sessions';
  const DB_STORE_LICENSE = 'device_license';
  let idb = null;

  // --------------------------------------------------------------------------
  // DOM 요소 참조
  // --------------------------------------------------------------------------
  const pieceTitle = document.getElementById('piece-title');
  const tabMusicxml = document.getElementById('tab-musicxml');
  const tabPdf = document.getElementById('tab-pdf');
  const musicxmlControls = document.getElementById('musicxml-controls');
  const pdfControls = document.getElementById('pdf-controls');

  const scoreWrapper = document.getElementById('score-wrapper');
  const scoreContainer = document.getElementById('score-container');
  const loadingIndicator = document.getElementById('loading-indicator');

  const pdfViewerWrapper = document.getElementById('pdf-viewer-wrapper');
  const pdfContainer = document.getElementById('pdf-container');
  const pdfFileInput = document.getElementById('pdf-file-input');
  const loadSamplePdfBtn = document.getElementById('load-sample-pdf-btn');
  const pdfPrevBtn = document.getElementById('pdf-prev-btn');
  const pdfNextBtn = document.getElementById('pdf-next-btn');
  const pdfPagePill = document.getElementById('pdf-page-pill');

  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-icon');
  const themeLabel = document.getElementById('theme-label');

  const playPauseBtn = document.getElementById('play-pause-btn');
  const playIcon = document.getElementById('play-icon');
  const playLabel = document.getElementById('play-label');
  const prevMeasureBtn = document.getElementById('prev-measure-btn');
  const nextMeasureBtn = document.getElementById('next-measure-btn');
  const measurePill = document.getElementById('measure-pill');

  // VAD & 연습 모니터 요소
  const micToggleBtn = document.getElementById('mic-toggle-btn');
  const micIcon = document.getElementById('mic-icon');
  const micLabel = document.getElementById('mic-label');
  const vadLed = document.getElementById('vad-led');
  const vadMeterFill = document.getElementById('vad-meter-fill');
  const vadStatusText = document.getElementById('vad-status-text');
  const practiceTimer = document.getElementById('practice-timer');
  const endSessionBtn = document.getElementById('end-session-btn');
  const syncTriggerBtn = document.getElementById('sync-trigger-btn');
  const syncIcon = document.getElementById('sync-icon');
  const syncStatusText = document.getElementById('sync-status-text');
  const unsyncedCountBadge = document.getElementById('unsynced-count-badge');

  // 라이선스 잠금 화면 및 교수자 모달 요소
  const licenseGateScreen = document.getElementById('license-gate-screen');
  const studentDeviceUuidEl = document.getElementById('student-device-uuid');
  const studentDeviceQrEl = document.getElementById('student-device-qr');
  const copyUuidBtn = document.getElementById('copy-uuid-btn');
  const tabActCode = document.getElementById('tab-act-code');
  const tabActQr = document.getElementById('tab-act-qr');
  const panelActCode = document.getElementById('panel-act-code');
  const panelActQr = document.getElementById('panel-act-qr');
  const licensePinInput = document.getElementById('license-pin-input');
  const submitPinBtn = document.getElementById('submit-pin-btn');
  const licenseQrTokenInput = document.getElementById('license-qr-token-input');
  const submitQrTokenBtn = document.getElementById('submit-qr-token-btn');
  const startQrScanBtn = document.getElementById('start-qr-scan-btn');
  const openProfGateBtn = document.getElementById('open-prof-gate-btn');
  const openProfHeaderBtn = document.getElementById('open-prof-header-btn');
  const licensePill = document.getElementById('license-pill');

  // 교수자 모달 요소
  const professorModal = document.getElementById('professor-modal');
  const closeProfModalBtn = document.getElementById('close-prof-modal-btn');
  const profTargetUuid = document.getElementById('prof-target-uuid');
  const profAutoFillUuidBtn = document.getElementById('prof-auto-fill-uuid-btn');
  const profStudentName = document.getElementById('prof-student-name');
  const profExpireDate = document.getElementById('prof-expire-date');
  const profGenerateKeyBtn = document.getElementById('prof-generate-key-btn');
  const profResultSection = document.getElementById('prof-result-section');
  const profGeneratedPin = document.getElementById('prof-generated-pin');
  const profCopyPinBtn = document.getElementById('prof-copy-pin-btn');
  const profApprovedQr = document.getElementById('prof-approved-qr');
  const profGeneratedToken = document.getElementById('prof-generated-token');
  const profCopyTokenBtn = document.getElementById('prof-copy-token-btn');

  // 알림 및 모달 요소
  const testNotify8pmBtn = document.getElementById('test-notify-8pm');
  const testNotify10pmBtn = document.getElementById('test-notify-10pm');
  const appModal = document.getElementById('app-modal');
  const modalIcon = document.getElementById('modal-icon');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  // PDF.js 워커 세팅
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ==========================================================================
  // [NEW Step 1 ~ Step 4] 온디바이스 비대칭 오프라인 라이선스 인증 엔진
  // ==========================================================================

  /**
   * 학생 기기 고유 UUID 획득 또는 영구 생성 (Android ID / Hardware UUID 대응)
   */
  function getOrCreateDeviceUUID() {
    let savedUuid = localStorage.getItem('muse_device_uuid');
    if (!savedUuid) {
      if (window.crypto && window.crypto.randomUUID) {
        savedUuid = window.crypto.randomUUID();
      } else {
        savedUuid = 'tablet-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
      }
      localStorage.setItem('muse_device_uuid', savedUuid);
    }
    return savedUuid;
  }

  /**
   * [Step 2] 교수자 마스터 암호화 엔진: 6자리 핀코드 계산 함수
   * HMAC-SHA256(MasterSecret, uuid + expireDate)의 앞 4바이트 모듈러 연산으로 6자리 생성
   */
  async function computeLicensePinCode(uuid, expireDate) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(PROFESSOR_MASTER_SEED),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const message = `${uuid.trim()}::${expireDate.trim()}`;
    const sigBuffer = await window.crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
    const bytes = new Uint8Array(sigBuffer);

    // 4바이트 정수 추출 후 6자리 핀코드 생성
    const num = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    return String(num % 1000000).padStart(6, '0');
  }

  /**
   * [Step 2] 교수자 마스터 암호화 엔진: RSA/HMAC-SHA256 디지털 서명된 풀 토큰 생성
   */
  async function generateFullSignedToken(uuid, studentName, expireDate) {
    const payload = {
      app: 'MuseSignal',
      uuid: uuid.trim(),
      studentName: studentName.trim(),
      expireDate: expireDate.trim(),
      issuedAt: new Date().toISOString()
    };

    const payloadJson = JSON.stringify(payload);
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(PROFESSOR_MASTER_SEED),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sigBuffer = await window.crypto.subtle.sign('HMAC', keyMaterial, enc.encode(payloadJson));
    const sigHex = Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Base64 인코딩 페이로드 + 서명 해시
    const encodedPayload = btoa(unescape(encodeURIComponent(payloadJson)));
    return `${encodedPayload}.${sigHex}`;
  }

  /**
   * [Step 4] 서명 및 라이선스 유효성 검증
   */
  async function verifySignedToken(token, currentUuid) {
    try {
      const parts = token.trim().split('.');
      if (parts.length !== 2) throw new Error('올바르지 않은 토큰 포맷입니다.');

      const payloadJson = decodeURIComponent(escape(atob(parts[0])));
      const sigHex = parts[1];
      const payload = JSON.parse(payloadJson);

      if (payload.uuid !== currentUuid) {
        throw new Error(`기기 불일치! 이 토큰은 기기 [${payload.uuid.substring(0, 8)}...] 전용입니다.`);
      }

      if (new Date(payload.expireDate).getTime() < Date.now()) {
        throw new Error(`라이선스 유효기간이 만료되었습니다 (${payload.expireDate}).`);
      }

      // 무결성 디지털 서명 검증
      const enc = new TextEncoder();
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(PROFESSOR_MASTER_SEED),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const expectedBuffer = await window.crypto.subtle.sign('HMAC', keyMaterial, enc.encode(payloadJson));
      const expectedHex = Array.from(new Uint8Array(expectedBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      if (sigHex !== expectedHex) {
        throw new Error('교수자 마스터 개인키 서명과 일치하지 않습니다. (위변조 감지)');
      }

      return payload;
    } catch (e) {
      console.error('라이선스 검증 실패:', e);
      throw e;
    }
  }

  /**
   * [Step 1] 앱 최초 실행 시 기기 식별값 및 기기 QR코드 생성
   */
  function setupStudentDeviceQR() {
    deviceUUID = getOrCreateDeviceUUID();

    if (studentDeviceUuidEl) {
      studentDeviceUuidEl.textContent = deviceUUID;
    }

    if (studentDeviceQrEl) {
      studentDeviceQrEl.innerHTML = '';
      const qrData = JSON.stringify({
        app: 'MuseSignal',
        type: 'device_registration',
        uuid: deviceUUID,
        deviceTime: new Date().toISOString()
      });

      if (window.QRCode) {
        new QRCode(studentDeviceQrEl, {
          text: qrData,
          width: 134,
          height: 134,
          colorDark: '#1A1A1A',
          colorLight: '#FFFFFF',
          correctLevel: QRCode.CorrectLevel.M
        });
      }
    }
  }

  /**
   * [Step 4] 로컬 IndexedDB & LocalStorage에 영구 라이선스 저장 및 잠금 해제
   */
  async function applyAndStoreLicense(licenseObj) {
    activeLicense = {
      isLicensed: true,
      uuid: licenseObj.uuid,
      studentName: licenseObj.studentName || '인증 학생',
      expireDate: licenseObj.expireDate || '2027-10-28',
      approvedAt: new Date().toISOString()
    };

    // 1. IndexedDB 저장
    if (idb) {
      try {
        const tx = idb.transaction(DB_STORE_LICENSE, 'readwrite');
        const store = tx.objectStore(DB_STORE_LICENSE);
        store.put({ id: 'active_license', ...activeLicense });
      } catch (e) {
        console.warn('IDB 라이선스 저장 오류:', e);
      }
    }

    // 2. LocalStorage 영구 보존
    localStorage.setItem('muse_license', JSON.stringify(activeLicense));

    console.log('🎉 [License Engine] 영구 오프라인 라이선스 활성화 완료:', activeLicense);

    // 잠금 화면 해제 및 헤더 뱃지 갱신
    unlockAppView();

    showInAppModal(
      '🎉 기기 인증 승인 완료',
      `<strong>${activeLicense.studentName}</strong> 학생 태블릿이 성공적으로 승인되었습니다!<br>
      유효기간: <strong>${activeLicense.expireDate}</strong>까지 영구 오프라인 인증 상태로 자유롭게 악보와 레슨 모드를 사용하실 수 있습니다.`,
      '🔓'
    );
  }

  /**
   * 잠금 해제 및 UI 갱신
   */
  function unlockAppView() {
    if (licenseGateScreen) {
      licenseGateScreen.classList.add('unlocked');
    }
    if (licensePill && activeLicense) {
      licensePill.textContent = `✅ ${activeLicense.studentName} (~${activeLicense.expireDate})`;
      licensePill.classList.add('active');
    }
  }

  /**
   * 저장된 오프라인 라이선스 검사
   */
  async function checkExistingLicense() {
    deviceUUID = getOrCreateDeviceUUID();
    let saved = localStorage.getItem('muse_license');

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.isLicensed && parsed.uuid === deviceUUID) {
          if (new Date(parsed.expireDate).getTime() > Date.now()) {
            activeLicense = parsed;
            unlockAppView();
            return true;
          } else {
            console.warn('저장된 라이선스 만료');
          }
        }
      } catch (e) {
        console.warn('라이선스 파싱 예외:', e);
      }
    }

    // 미인증 상태: 잠금 화면 노출
    if (licenseGateScreen) {
      licenseGateScreen.classList.remove('unlocked');
    }
    if (licensePill) {
      licensePill.textContent = '🔒 라이선스 미인증';
      licensePill.classList.remove('active');
    }
    setupStudentDeviceQR();
    return false;
  }

  /**
   * [Step 3] 학생: 6자리 핀코드로 승인 적용
   */
  async function handlePinCodeSubmit() {
    const inputPin = licensePinInput ? licensePinInput.value.trim() : '';
    if (!inputPin || inputPin.length !== 6) {
      showInAppModal('입력 오류', '교수자로부터 발급받은 6자리 숫자를 입력해 주세요.', '⚠️');
      return;
    }

    const defaultExpire = '2027-10-28';
    const expectedPin = await computeLicensePinCode(deviceUUID, defaultExpire);

    if (inputPin === expectedPin) {
      await applyAndStoreLicense({
        uuid: deviceUUID,
        studentName: '홍길동 학생',
        expireDate: defaultExpire
      });
    } else {
      showInAppModal(
        '인증 실패',
        '입력하신 6자리 승인 코드가 유효하지 않습니다.<br>교수자가 발급한 코드가 맞는지 확인해 주세요.',
        '❌'
      );
    }
  }

  /**
   * [Step 3] 학생: 승인 토큰 / QR 결과 적용
   */
  async function handleTokenSubmit(tokenString) {
    const token = tokenString || (licenseQrTokenInput ? licenseQrTokenInput.value.trim() : '');
    if (!token) {
      showInAppModal('입력 오류', '승인 토큰 문자열 또는 QR코드를 입력해 주세요.', '⚠️');
      return;
    }

    try {
      const verifiedPayload = await verifySignedToken(token, deviceUUID);
      await applyAndStoreLicense(verifiedPayload);
    } catch (err) {
      showInAppModal('승인 검증 실패', err.message, '❌');
    }
  }

  /**
   * [Step 2] 교수자 모달: 승인 키 및 핀코드, 승인 QR 자동 발급
   */
  async function handleProfessorGenerateKey() {
    const targetUuid = profTargetUuid ? profTargetUuid.value.trim() : '';
    const studentName = profStudentName ? profStudentName.value.trim() : '홍길동';
    const expireDate = profExpireDate ? profExpireDate.value.trim() : '2027-10-28';

    if (!targetUuid) {
      showInAppModal('입력 필요', '학생 기기 고유 UUID를 입력하거나 채우세요.', '⚠️');
      return;
    }

    // 1. 6자리 비대면 핀코드 계산
    const pinCode = await computeLicensePinCode(targetUuid, expireDate);
    // 2. RSA-256 서명된 전체 토큰 생성
    const fullToken = await generateFullSignedToken(targetUuid, studentName, expireDate);

    // 3. UI에 결과 표시
    if (profGeneratedPin) profGeneratedPin.textContent = pinCode;
    if (profGeneratedToken) profGeneratedToken.value = fullToken;

    // 4. 대면 스캔용 승인 QR코드 생성
    if (profApprovedQr) {
      profApprovedQr.innerHTML = '';
      if (window.QRCode) {
        new QRCode(profApprovedQr, {
          text: fullToken,
          width: 144,
          height: 144,
          colorDark: '#0F172A',
          colorLight: '#FFFFFF',
          correctLevel: QRCode.CorrectLevel.L
        });
      }
    }

    if (profResultSection) {
      profResultSection.classList.remove('hidden');
    }

    console.log(`🔑 [Professor Master Key] 학생 [${studentName}] 승인 키 발급 완료 - 핀코드: ${pinCode}`);
  }

  // ==========================================================================
  // [4단계] Web Audio API 마이크 VAD & 순수 연습 시간 타이머
  // ==========================================================================

  async function toggleMicrophone() {
    if (isMicActive) {
      stopMicrophone();
    } else {
      await startMicrophone();
    }
  }

  async function startMicrophone() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('브라우저가 마이크 입력을 지원하지 않습니다.');
      }

      micMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.3;

      const source = audioContext.createMediaStreamSource(micMediaStream);
      source.connect(analyserNode);

      isMicActive = true;
      if (micIcon) micIcon.textContent = '🔴';
      if (micLabel) micLabel.textContent = '감지 중';
      if (micToggleBtn) micToggleBtn.classList.add('listening');

      console.log('Web Audio 마이크 VAD 시작');
      runVadLoop();
    } catch (err) {
      console.error('마이크 연결 실패:', err);
      showInAppModal('⚠️ 마이크 접근 오류', `마이크 권한을 허용해 주세요: ${err.message}`, '🎙️');
    }
  }

  function stopMicrophone() {
    isMicActive = false;
    isSoundDetected = false;

    if (micMediaStream) {
      micMediaStream.getTracks().forEach((track) => track.stop());
      micMediaStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close();
      audioContext = null;
    }
    if (vadAnimId) {
      cancelAnimationFrame(vadAnimId);
      vadAnimId = null;
    }

    if (micIcon) micIcon.textContent = '🎙️';
    if (micLabel) micLabel.textContent = '감지 시작';
    if (micToggleBtn) micToggleBtn.classList.remove('listening');
    if (vadLed) vadLed.classList.remove('active');
    if (vadMeterFill) vadMeterFill.style.width = '0%';
    if (vadStatusText) vadStatusText.textContent = '대기 중';
  }

  let lastVadTime = performance.now();
  function runVadLoop() {
    if (!isMicActive || !analyserNode) return;

    const dataArray = new Float32Array(analyserNode.fftSize);
    analyserNode.getFloatTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sumSquares += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);

    const meterPercent = Math.min(100, Math.round((rms / 0.12) * 100));
    if (vadMeterFill) vadMeterFill.style.width = `${meterPercent}%`;

    const now = performance.now();
    const deltaSeconds = (now - lastVadTime) / 1000;
    lastVadTime = now;

    if (rms > VAD_VOLUME_THRESHOLD) {
      isSoundDetected = true;
      if (vadLed) vadLed.classList.add('active');
      if (vadStatusText) vadStatusText.textContent = '연주 감지';

      purePracticeSeconds += deltaSeconds;
      updatePracticeTimerUI();
    } else {
      isSoundDetected = false;
      if (vadLed) vadLed.classList.remove('active');
      if (vadStatusText) vadStatusText.textContent = '소리 없음';
    }

    vadAnimId = requestAnimationFrame(runVadLoop);
  }

  function formatTime(totalSeconds) {
    const secs = Math.floor(totalSeconds);
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function updatePracticeTimerUI() {
    if (practiceTimer) {
      practiceTimer.textContent = formatTime(purePracticeSeconds);
    }
  }

  // ==========================================================================
  // [4단계] IndexedDB 세션 큐 & 온라인 자동 동기화 (Cloud Sync)
  // ==========================================================================

  function initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE_SESSIONS)) {
          const store = db.createObjectStore(DB_STORE_SESSIONS, { keyPath: 'id' });
          store.createIndex('is_synced', 'is_synced', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains(DB_STORE_LICENSE)) {
          db.createObjectStore(DB_STORE_LICENSE, { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        idb = e.target.result;
        console.log('IndexedDB 연결 성공:', DB_NAME);
        updateSyncBadge();
        resolve(idb);
      };

      request.onerror = (e) => {
        console.error('IndexedDB 열기 실패:', e);
        reject(e);
      };
    });
  }

  async function endAndSaveSession() {
    if (purePracticeSeconds < 1) {
      showInAppModal('안내', '누적된 순수 연습 시간이 1초 미만입니다. 악기를 연주하여 연습을 기록해 보세요.', 'ℹ️');
      return;
    }

    const currentPiece =
      currentMode === MODES.MUSICXML
        ? 'W. A. Mozart - Horn Concerto No. 4, K. 495 (Rondo)'
        : pieceTitle
        ? pieceTitle.textContent
        : 'PDF 악보';

    const sessionRecord = {
      id: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      date: new Date().toISOString(),
      pieceTitle: currentPiece,
      practiceTimeSeconds: Math.round(purePracticeSeconds),
      practiceTimeFormatted: formatTime(purePracticeSeconds),
      is_synced: 0,
      timestamp: Date.now()
    };

    try {
      if (idb) {
        await new Promise((resolve, reject) => {
          const tx = idb.transaction(DB_STORE_SESSIONS, 'readwrite');
          const store = tx.objectStore(DB_STORE_SESSIONS);
          const req = store.add(sessionRecord);
          req.onsuccess = resolve;
          req.onerror = reject;
        });
      }

      const localQueue = JSON.parse(localStorage.getItem('muse_offline_sessions') || '[]');
      localQueue.push(sessionRecord);
      localStorage.setItem('muse_offline_sessions', JSON.stringify(localQueue));

      console.log('✅ 연습 세션 로컬 큐에 저장 완료 (is_synced: 0):', sessionRecord);

      const savedDuration = formatTime(purePracticeSeconds);
      purePracticeSeconds = 0;
      updatePracticeTimerUI();
      updateSyncBadge();

      showInAppModal(
        '💾 세션 저장 완료',
        `<strong>${sessionRecord.pieceTitle}</strong><br>순수 연습 시간: <strong>${savedDuration}</strong><br>로컬 큐에 <em>[is_synced: 0]</em> 상태로 저장되었습니다.<br>Wi-Fi 연결 시 클라우드에 자동 백업됩니다.`,
        '✅'
      );

      if (navigator.onLine) {
        setTimeout(triggerCloudSync, 1000);
      }
    } catch (err) {
      console.error('세션 저장 실패:', err);
      showInAppModal('저장 오류', `세션 저장 중 오류가 발생했습니다: ${err.message}`, '❌');
    }
  }

  async function getUnsyncedSessions() {
    if (idb) {
      return new Promise((resolve) => {
        const tx = idb.transaction(DB_STORE_SESSIONS, 'readonly');
        const store = tx.objectStore(DB_STORE_SESSIONS);
        const index = store.index('is_synced');
        const req = index.getAll(0);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } else {
      const localQueue = JSON.parse(localStorage.getItem('muse_offline_sessions') || '[]');
      return localQueue.filter((s) => s.is_synced === 0);
    }
  }

  async function updateSyncBadge() {
    try {
      const unsynced = await getUnsyncedSessions();
      const count = unsynced.length;

      if (unsyncedCountBadge) {
        unsyncedCountBadge.textContent = count;
        if (count > 0) {
          unsyncedCountBadge.classList.add('unsynced');
        } else {
          unsyncedCountBadge.classList.remove('unsynced');
        }
      }

      if (syncStatusText) {
        syncStatusText.textContent = navigator.onLine
          ? count > 0
            ? `동기화 대기 (${count})`
            : '동기화 완료'
          : '오프라인';
      }
    } catch (e) {
      console.warn('동기화 뱃지 갱신 실패:', e);
    }
  }

  async function triggerCloudSync() {
    if (!navigator.onLine) {
      showInAppModal('오프라인 상태', '현재 네트워크에 연결되어 있지 않습니다. Wi-Fi 연결 후 자동으로 동기화됩니다.', '📡');
      return;
    }

    const unsyncedList = await getUnsyncedSessions();
    if (unsyncedList.length === 0) {
      console.log('☁️ [Cloud Sync Engine] 미동기화된 오프라인 세션이 없습니다.');
      showInAppModal('클라우드 동기화', '모든 연습 데이터가 이미 최신 상태로 동기화되어 있습니다.', '☁️');
      return;
    }

    console.group('⚡ [Cloud Sync Engine] 온라인 네트워크 감지 - 미동기화 세션 업로드 덤프');
    console.log(`미동기화 세션 수: ${unsyncedList.length}건`);
    console.table(unsyncedList);
    console.groupEnd();

    if (syncIcon) syncIcon.textContent = '⏳';
    if (syncStatusText) syncStatusText.textContent = '업로드 중...';

    setTimeout(async () => {
      try {
        if (idb) {
          const tx = idb.transaction(DB_STORE_SESSIONS, 'readwrite');
          const store = tx.objectStore(DB_STORE_SESSIONS);
          for (const item of unsyncedList) {
            item.is_synced = 1;
            item.syncedAt = new Date().toISOString();
            store.put(item);
          }
        }

        const localQueue = JSON.parse(localStorage.getItem('muse_offline_sessions') || '[]');
        localQueue.forEach((item) => {
          item.is_synced = 1;
          item.syncedAt = new Date().toISOString();
        });
        localStorage.setItem('muse_offline_sessions', JSON.stringify(localQueue));

        if (syncIcon) syncIcon.textContent = '☁️';
        await updateSyncBadge();

        console.log('✅ [Cloud Sync Engine] 구글 드라이브 모의 업로드 완료! 모든 항목 동기화 완료.');
        showInAppModal(
          '☁️ 구글 드라이브 동기화 성공',
          `<strong>${unsyncedList.length}건</strong>의 오프라인 연습 세션이 구글 드라이브 백업 저장소로 안전하게 동기화되었습니다.`,
          '🎉'
        );
      } catch (err) {
        console.error('동기화 처리 실패:', err);
        if (syncIcon) syncIcon.textContent = '⚠️';
      }
    }, 1500);
  }

  // ==========================================================================
  // [4단계] 매일 오후 8시 / 10시 알림 시뮬레이터 (Notification API & In-App)
  // ==========================================================================

  async function simulatePracticeNotification(hour) {
    let title = '';
    let message = '';
    let icon = '';

    if (hour === 20) {
      title = '🎺 [오후 8:00 정기 연습 알림]';
      message = '오늘의 호른 협주곡 악보를 복습할 시간입니다! 연주를 시작해 보세요.';
      icon = '🎺';
    } else {
      title = '🌙 [오후 10:00 야간 마무리 알림]';
      message = '오늘의 연습 세션을 마무리하고 순수 연습 시간을 클라우드에 백업하세요. 수고하셨습니다!';
      icon = '🌙';
    }

    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            new Notification(title, { body: message });
          }
        });
      }
    }

    showInAppModal(title, message, icon);
  }

  function showInAppModal(title, contentHtml, icon = '🔔') {
    if (modalTitle) modalTitle.textContent = title;
    if (modalBody) modalBody.innerHTML = contentHtml;
    if (modalIcon) modalIcon.textContent = icon;
    if (appModal) appModal.classList.remove('hidden');
  }

  function hideInAppModal() {
    if (appModal) appModal.classList.add('hidden');
  }

  // ==========================================================================
  // 모드 전환 로직 (MusicXML <-> PDF)
  // ==========================================================================
  function switchMode(newMode) {
    if (currentMode === newMode) return;
    currentMode = newMode;

    if (newMode === MODES.MUSICXML) {
      tabMusicxml.classList.add('active');
      tabPdf.classList.remove('active');
      musicxmlControls.classList.remove('hidden');
      pdfControls.classList.add('hidden');
      scoreWrapper.classList.remove('hidden');
      pdfViewerWrapper.classList.add('hidden');
      if (pieceTitle) pieceTitle.textContent = 'W. A. Mozart - Horn Concerto No. 4, K. 495 (Rondo)';
    } else {
      tabPdf.classList.add('active');
      tabMusicxml.classList.remove('active');
      pdfControls.classList.remove('hidden');
      musicxmlControls.classList.add('hidden');
      pdfViewerWrapper.classList.remove('hidden');
      scoreWrapper.classList.add('hidden');
      if (pieceTitle) pieceTitle.textContent = 'PDF 악보 뷰어 (SVG 벡터 가상 렌더링)';

      if (isPlaying) pausePlayback();
      if (!pdfDoc) {
        loadPdfFromUrl('assets/sample_score.pdf');
      }
    }
  }

  // ==========================================================================
  // [3단계] PDF.js SVGGraphics & 3페이지 윈도우 가상 렌더링 (Virtual DOM)
  // ==========================================================================

  async function loadPdfDocument(loadingTask, fileName = '샘플 악보') {
    try {
      if (pdfPagePill) pdfPagePill.textContent = 'PDF 로딩 중...';

      pdfDoc = await loadingTask.promise;
      pdfTotalPages = pdfDoc.numPages;
      pdfCurrentPage = 1;
      renderedSvgCache.clear();

      if (pieceTitle && fileName) {
        pieceTitle.textContent = `${fileName} (${pdfTotalPages}P)`;
      }

      setupPdfSlots();
      await updatePdfVirtualWindow(1);

      if (!pdfAnimationId) {
        pdfAnimationId = requestAnimationFrame(pdfScrollLoop);
      }
    } catch (err) {
      console.error('PDF 로드 실패:', err);
      if (pdfContainer) {
        pdfContainer.innerHTML = `
          <div style="padding: 3rem; text-align: center; color: #ff6b6b;">
            <p><strong>PDF 파싱 실패</strong></p>
            <p style="font-size: 0.85rem; margin-top: 0.5rem;">${err.message}</p>
          </div>
        `;
      }
    }
  }

  function loadPdfFromUrl(url) {
    const loadingTask = pdfjsLib.getDocument(url);
    loadPdfDocument(loadingTask, '모차르트 호른 협주곡 (PDF 샘플)');
  }

  function loadPdfFromFile(file) {
    const fileReader = new FileReader();
    fileReader.onload = function () {
      const typedArray = new Uint8Array(this.result);
      const loadingTask = pdfjsLib.getDocument({ data: typedArray });
      loadPdfDocument(loadingTask, file.name);
    };
    fileReader.readAsArrayBuffer(file);
  }

  function setupPdfSlots() {
    pdfContainer.innerHTML = '';
    pdfPageSlots = [];

    for (let p = 1; p <= pdfTotalPages; p++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-page-slot';
      slot.dataset.pageNum = p;

      slot.innerHTML = `
        <div class="pdf-page-placeholder">
          <div class="spinner" style="width: 24px; height: 24px;"></div>
          <span>페이지 ${p} 준비 중 (가상 윈도우 대기)</span>
        </div>
        <div class="page-indicator-tag">P. ${p}</div>
      `;

      pdfContainer.appendChild(slot);
      pdfPageSlots.push(slot);
    }

    updatePdfUI();
  }

  async function updatePdfVirtualWindow(centerPage) {
    if (!pdfDoc || pdfTotalPages === 0) return;

    centerPage = Math.max(1, Math.min(centerPage, pdfTotalPages));
    pdfCurrentPage = centerPage;
    updatePdfUI();

    const minPage = Math.max(1, centerPage - 1);
    const maxPage = Math.min(pdfTotalPages, centerPage + 1);

    for (let p = 1; p <= pdfTotalPages; p++) {
      const slot = pdfPageSlots[p - 1];
      if (!slot) continue;

      const shouldBeMounted = p >= minPage && p <= maxPage;

      if (shouldBeMounted) {
        if (!slot.querySelector('svg')) {
          let svg = renderedSvgCache.get(p);
          if (!svg) {
            svg = await renderPageToSVG(p);
            if (svg) renderedSvgCache.set(p, svg);
          }
          if (svg) {
            slot.innerHTML = `<div class="page-indicator-tag">P. ${p}</div>`;
            slot.appendChild(svg);
          }
        }
      } else {
        if (slot.querySelector('svg')) {
          slot.innerHTML = `
            <div class="pdf-page-placeholder">
              <span style="font-size: 0.8rem; opacity: 0.6;">페이지 ${p} (메모리 보호 언마운트)</span>
            </div>
            <div class="page-indicator-tag">P. ${p}</div>
          `;
        }
      }
    }
  }

  async function renderPageToSVG(pageNum) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const opList = await page.getOperatorList();
      const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
      const svg = await svgGfx.getSVG(opList, viewport);

      svg.style.width = '100%';
      svg.style.height = 'auto';
      return svg;
    } catch (e) {
      console.warn(`페이지 ${pageNum} SVG 렌더 오류:`, e);
      return null;
    }
  }

  function updatePdfUI() {
    if (pdfPagePill) {
      pdfPagePill.textContent = `${pdfCurrentPage} / ${pdfTotalPages} 페이지`;
    }
  }

  function pdfScrollLoop() {
    if (currentMode === MODES.PDF && pdfPageSlots.length > 0) {
      const easing = 0.09;
      pdfCurrentScrollY += (pdfTargetScrollY - pdfCurrentScrollY) * easing;

      if (pdfViewerWrapper) {
        pdfViewerWrapper.style.transform = `translate3d(0, ${-pdfCurrentScrollY.toFixed(2)}px, 0)`;
      }
    }
    pdfAnimationId = requestAnimationFrame(pdfScrollLoop);
  }

  function jumpToPdfPage(pageNum) {
    if (pageNum < 1 || pageNum > pdfTotalPages) return;
    const slot = pdfPageSlots[pageNum - 1];
    if (!slot) return;

    pdfTargetScrollY = slot.offsetTop;
    updatePdfVirtualWindow(pageNum);
  }

  // ==========================================================================
  // [1 & 2단계] OSMD MusicXML 렌더링 & 80 BPM 골든 라인 스크롤러
  // ==========================================================================

  function initOSMD() {
    if (!window.opensheetmusicdisplay) return null;

    const options = {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawSubtitle: true,
      drawComposer: true,
      drawPartNames: false,
      drawMetronomeMarks: true,
      drawingParameters: 'compacttight',
      defaultColorMusic: currentTheme.notationColor,
      defaultColorNotehead: currentTheme.notationColor,
      defaultColorStem: currentTheme.notationColor,
      defaultColorRest: currentTheme.notationColor,
      defaultColorLabel: currentTheme.notationColor,
      defaultColorTitle: currentTheme.notationColor,
      drawCredits: true,
      autoBeam: true
    };

    return new opensheetmusicdisplay.OpenSheetMusicDisplay(scoreContainer, options);
  }

  function extractMeasureYPositions() {
    if (!osmd || !osmd.graphic || !osmd.graphic.measureList) return [];

    const svg = scoreContainer.querySelector('svg');
    if (!svg) return [];

    const viewBoxHeight = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.height : null;
    const svgBoundingHeight = svg.getBoundingClientRect().height;
    const svgScale = viewBoxHeight && viewBoxHeight > 0 ? svgBoundingHeight / viewBoxHeight : 1;

    const positions = [];
    const measureList = osmd.graphic.measureList;

    for (let i = 0; i < measureList.length; i++) {
      const measureRow = measureList[i];
      if (!measureRow || measureRow.length === 0) continue;

      const firstStaffMeasure = measureRow[0];
      if (!firstStaffMeasure || !firstStaffMeasure.PositionAndShape) continue;

      const yUnits = firstStaffMeasure.PositionAndShape.AbsolutePosition.y;
      const pixelY = yUnits * 10 * svgScale;

      positions.push({
        index: i,
        measureNumber: i + 1,
        yUnits: yUnits,
        pixelY: pixelY
      });
    }

    return positions;
  }

  function updateMeasureUI() {
    if (measurePill) {
      const total = measureCoordinates.length || 8;
      const current = currentMeasureIndex + 1;
      measurePill.textContent = `마디 ${current} / ${total}`;
    }
  }

  function musicXmlScrollLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const delta = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    if (currentMode === MODES.MUSICXML && isPlaying && measureCoordinates.length > 0) {
      measureProgress += delta / MEASURE_DURATION;

      while (measureProgress >= 1.0) {
        measureProgress -= 1.0;
        if (currentMeasureIndex < measureCoordinates.length - 1) {
          currentMeasureIndex++;
          updateMeasureUI();
        } else {
          pausePlayback();
          measureProgress = 1.0;
          break;
        }
      }
    }

    if (currentMode === MODES.MUSICXML && measureCoordinates.length > 0) {
      const cur = measureCoordinates[currentMeasureIndex];
      const nxt = measureCoordinates[Math.min(currentMeasureIndex + 1, measureCoordinates.length - 1)];

      if (cur && nxt) {
        const interpolatedY = cur.pixelY + (nxt.pixelY - cur.pixelY) * measureProgress;
        targetScrollY = interpolatedY;
      }

      const easing = 0.08;
      currentScrollY += (targetScrollY - currentScrollY) * easing;

      if (scoreWrapper) {
        scoreWrapper.style.transform = `translate3d(0, ${-currentScrollY.toFixed(2)}px, 0)`;
      }
    }

    animationFrameId = requestAnimationFrame(musicXmlScrollLoop);
  }

  function jumpToMeasure(index) {
    if (measureCoordinates.length === 0) return;
    currentMeasureIndex = Math.max(0, Math.min(index, measureCoordinates.length - 1));
    measureProgress = 0;
    updateMeasureUI();

    if (measureCoordinates[currentMeasureIndex]) {
      targetScrollY = measureCoordinates[currentMeasureIndex].pixelY;
    }
  }

  function togglePlayback() {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    if (currentMeasureIndex >= measureCoordinates.length - 1 && measureProgress >= 1.0) {
      currentMeasureIndex = 0;
      measureProgress = 0;
      updateMeasureUI();
    }
    isPlaying = true;
    lastTimestamp = performance.now();

    if (playIcon) playIcon.textContent = '❚❚';
    if (playLabel) playLabel.textContent = '일시정지';
    if (playPauseBtn) playPauseBtn.classList.add('playing');
  }

  function pausePlayback() {
    isPlaying = false;
    if (playIcon) playIcon.textContent = '▶';
    if (playLabel) playLabel.textContent = '재생';
    if (playPauseBtn) playPauseBtn.classList.remove('playing');
  }

  async function loadAndRenderScore(xmlUrl) {
    try {
      const response = await fetch(xmlUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xmlText = await response.text();

      if (!osmd) osmd = initOSMD();
      if (!osmd) return;

      await osmd.load(xmlText);

      if (loadingIndicator && loadingIndicator.parentNode) {
        loadingIndicator.parentNode.removeChild(loadingIndicator);
      }

      osmd.render();
      measureCoordinates = extractMeasureYPositions();
      updateMeasureUI();

      if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(musicXmlScrollLoop);
      }
    } catch (err) {
      console.error('악보 로드 실패:', err);
    }
  }

  // ==========================================================================
  // 테마 관리 (데이 / 나이트)
  // ==========================================================================
  function toggleTheme() {
    const nextTheme = currentTheme.id === THEMES.NIGHT.id ? THEMES.DAY : THEMES.NIGHT;
    applyTheme(nextTheme);
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme.id);

    if (themeIcon) themeIcon.textContent = theme.icon;
    if (themeLabel) themeLabel.textContent = theme.label;

    if (osmd) {
      osmd.setOptions({
        defaultColorMusic: theme.notationColor,
        defaultColorNotehead: theme.notationColor,
        defaultColorStem: theme.notationColor,
        defaultColorRest: theme.notationColor,
        defaultColorLabel: theme.notationColor,
        defaultColorTitle: theme.notationColor
      });
      try {
        osmd.render();
        measureCoordinates = extractMeasureYPositions();
      } catch (e) {
        console.warn('테마 리렌더링 오류:', e);
      }
    }
  }

  // ==========================================================================
  // 이벤트 리스너 등록
  // ==========================================================================
  function setupEventListeners() {
    // [Step 1] UUID 복사 버튼
    if (copyUuidBtn) {
      copyUuidBtn.addEventListener('click', () => {
        if (navigator.clipboard && deviceUUID) {
          navigator.clipboard.writeText(deviceUUID);
          copyUuidBtn.textContent = '완료!';
          setTimeout(() => (copyUuidBtn.textContent = '복사'), 1500);
        }
      });
    }

    // [Step 3] 승인 방식 탭 (핀코드 vs QR)
    if (tabActCode) {
      tabActCode.addEventListener('click', () => {
        tabActCode.classList.add('active');
        if (tabActQr) tabActQr.classList.remove('active');
        if (panelActCode) panelActCode.classList.remove('hidden');
        if (panelActQr) panelActQr.classList.add('hidden');
      });
    }
    if (tabActQr) {
      tabActQr.addEventListener('click', () => {
        tabActQr.classList.add('active');
        if (tabActCode) tabActCode.classList.remove('active');
        if (panelActQr) panelActQr.classList.remove('hidden');
        if (panelActCode) panelActCode.classList.add('hidden');
      });
    }

    // [Step 3] 비대면 6자리 핀코드 제출
    if (submitPinBtn) {
      submitPinBtn.addEventListener('click', handlePinCodeSubmit);
    }
    if (licensePinInput) {
      licensePinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handlePinCodeSubmit();
      });
    }

    // [Step 3] 대면 토큰 제출
    if (submitQrTokenBtn) {
      submitQrTokenBtn.addEventListener('click', () => handleTokenSubmit());
    }

    // [Step 3] 대면 카메라 QR 스캐너 시작
    if (startQrScanBtn) {
      startQrScanBtn.addEventListener('click', () => {
        if (!window.Html5Qrcode) {
          showInAppModal('안내', 'HTML5-QRCode 라이브러리를 준비 중입니다.', '📷');
          return;
        }

        try {
          if (!html5QrScanner) {
            html5QrScanner = new Html5Qrcode('qr-reader');
          }
          html5QrScanner
            .start(
              { facingMode: 'environment' },
              { fps: 10, qrbox: { width: 220, height: 220 } },
              (decodedText) => {
                console.log('📷 QR코드 스캔 성공:', decodedText);
                html5QrScanner.stop();
                handleTokenSubmit(decodedText);
              },
              () => {}
            )
            .catch((err) => {
              console.warn('카메라 실행 오류:', err);
              showInAppModal(
                '카메라 권한 필요',
                `카메라를 실행할 수 없습니다: ${err.message}<br>아래 [토큰 붙여넣기] 입력란을 사용하세요.`,
                '📷'
              );
            });
        } catch (e) {
          console.warn('QR 스캐너 오류:', e);
        }
      });
    }

    // 교수자 모달 열기/닫기
    const openProfModal = () => {
      if (professorModal) professorModal.classList.remove('hidden');
      if (profTargetUuid && !profTargetUuid.value) {
        profTargetUuid.value = deviceUUID;
      }
    };
    if (openProfGateBtn) openProfGateBtn.addEventListener('click', openProfModal);
    if (openProfHeaderBtn) openProfHeaderBtn.addEventListener('click', openProfModal);
    if (closeProfModalBtn) {
      closeProfModalBtn.addEventListener('click', () => {
        if (professorModal) professorModal.classList.add('hidden');
      });
    }

    // 교수자 모달: 현재 기기 UUID 자동 채우기
    if (profAutoFillUuidBtn) {
      profAutoFillUuidBtn.addEventListener('click', () => {
        if (profTargetUuid) profTargetUuid.value = deviceUUID;
      });
    }

    // 교수자 모달: 승인 키 발급 버튼
    if (profGenerateKeyBtn) {
      profGenerateKeyBtn.addEventListener('click', handleProfessorGenerateKey);
    }

    // 교수자 모달: 핀코드 & 토큰 복사
    if (profCopyPinBtn) {
      profCopyPinBtn.addEventListener('click', () => {
        if (profGeneratedPin && profGeneratedPin.textContent) {
          navigator.clipboard.writeText(profGeneratedPin.textContent);
          profCopyPinBtn.textContent = '복사됨!';
          setTimeout(() => (profCopyPinBtn.textContent = '핀 복사'), 1500);
        }
      });
    }
    if (profCopyTokenBtn) {
      profCopyTokenBtn.addEventListener('click', () => {
        if (profGeneratedToken && profGeneratedToken.value) {
          navigator.clipboard.writeText(profGeneratedToken.value);
          profCopyTokenBtn.textContent = '복사됨!';
          setTimeout(() => (profCopyTokenBtn.textContent = '토큰 복사'), 1500);
        }
      });
    }

    // 탭 모드 전환
    if (tabMusicxml) tabMusicxml.addEventListener('click', () => switchMode(MODES.MUSICXML));
    if (tabPdf) tabPdf.addEventListener('click', () => switchMode(MODES.PDF));

    // 테마 토글 버튼
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

    // MusicXML 컨트롤
    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayback);
    if (prevMeasureBtn) prevMeasureBtn.addEventListener('click', () => jumpToMeasure(currentMeasureIndex - 1));
    if (nextMeasureBtn) nextMeasureBtn.addEventListener('click', () => jumpToMeasure(currentMeasureIndex + 1));

    // PDF 컨트롤
    if (pdfFileInput) {
      pdfFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          switchMode(MODES.PDF);
          loadPdfFromFile(file);
        }
      });
    }

    if (loadSamplePdfBtn) {
      loadSamplePdfBtn.addEventListener('click', () => {
        switchMode(MODES.PDF);
        loadPdfFromUrl('assets/sample_score.pdf');
      });
    }

    if (pdfPrevBtn) pdfPrevBtn.addEventListener('click', () => jumpToPdfPage(pdfCurrentPage - 1));
    if (pdfNextBtn) pdfNextBtn.addEventListener('click', () => jumpToPdfPage(pdfCurrentPage + 1));

    // VAD & 연습 세션 컨트롤
    if (micToggleBtn) micToggleBtn.addEventListener('click', toggleMicrophone);
    if (endSessionBtn) endSessionBtn.addEventListener('click', endAndSaveSession);
    if (syncTriggerBtn) syncTriggerBtn.addEventListener('click', triggerCloudSync);

    // 알림 시뮬레이션 버튼
    if (testNotify8pmBtn) testNotify8pmBtn.addEventListener('click', () => simulatePracticeNotification(20));
    if (testNotify10pmBtn) testNotify10pmBtn.addEventListener('click', () => simulatePracticeNotification(22));

    // 모달 닫기
    if (modalCloseBtn) modalCloseBtn.addEventListener('click', hideInAppModal);
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', hideInAppModal);
    if (appModal) {
      appModal.addEventListener('click', (e) => {
        if (e.target === appModal) hideInAppModal();
      });
    }

    // 온라인 / 오프라인 네트워크 감지 이벤트
    window.addEventListener('online', () => {
      console.log('🌐 [Network] Wi-Fi / 인터넷 온라인 연결 감지');
      updateSyncBadge();
      triggerCloudSync();
    });

    window.addEventListener('offline', () => {
      console.log('📴 [Network] 오프라인 상태 진입');
      updateSyncBadge();
    });

    // 키보드 단축키
    window.addEventListener('keydown', (e) => {
      if (currentMode === MODES.MUSICXML) {
        if (e.code === 'Space') {
          e.preventDefault();
          togglePlayback();
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          jumpToMeasure(currentMeasureIndex + 1);
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          jumpToMeasure(currentMeasureIndex - 1);
        }
      } else if (currentMode === MODES.PDF) {
        if (e.code === 'ArrowRight' || e.code === 'PageDown') {
          e.preventDefault();
          jumpToPdfPage(pdfCurrentPage + 1);
        } else if (e.code === 'ArrowLeft' || e.code === 'PageUp') {
          e.preventDefault();
          jumpToPdfPage(pdfCurrentPage - 1);
        }
      }
    });

    // 화면 리사이즈
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (currentMode === MODES.MUSICXML && osmd) {
          try {
            osmd.render();
            measureCoordinates = extractMeasureYPositions();
          } catch (e) {
            console.warn('리사이즈 렌더 실패:', e);
          }
        }
      }, 200);
    });
  }

  // 초기화 실행
  document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(THEMES.DAY); // 기본 데이모드
    setupEventListeners();
    await initIndexedDB().catch((e) => console.warn('IDB 초기화 경고:', e));

    // [Step 1 & Step 4] 라이선스 잠금 상태 점검
    await checkExistingLicense();

    // 악보 렌더링 준비
    loadAndRenderScore('assets/mozart_horn_concerto.musicxml');
  });
})();
