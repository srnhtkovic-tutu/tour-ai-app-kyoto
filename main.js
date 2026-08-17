let spots = [];
const SUPABASE_URL = "https://fugibstqzkmzplqrpovn.supabase.co";
const SUPABASE_KEY = "sb_publishable_CM7-Kj4GEFY0oG2EI3t-XQ_MijxwUcZ";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

// =========================
// spots読み込み処理
// =========================
async function loadSpots() {

  const { data, error } = await supabaseClient
    .from("spots")
    .select("*");

  if (error) {
    console.error(error);
    return [];
  }

  console.log(data);

  console.log(
    JSON.stringify(data, null, 2)
  );

return data.map(spot => ({

  id: spot.id,
  name: spot.name,
  lat: Number(spot.lat),
  lng: Number(spot.lng),
  imageUrl: spot.image_url,
  guideData: spot.guide_data,

  catchCopy: spot.guide_data.catchCopy,
  topReason: spot.guide_data.topReason,
  ownerExperience: spot.guide_data.ownerExperience,
  highlightPoints: spot.guide_data.highlightPoints

}));

}

// =========================
// 設定値
// =========================

// 案内開始距離
let triggerDistance = 30;

// 離脱判定距離
const LEAVE_DISTANCE = 100;

// 滞在必要時間
const STAY_TIME = 1 * 1000;

// 案内クールタイム
const GUIDE_COOLDOWN =
  5 * 60 * 1000;


// =========================
// 状態管理
// =========================

let language = "ja";

// 現在対象スポット
let currentSpot = null;

// 接近開始時間
let enterTime = null;

// 最後に案内した時刻
const lastGuideTime = {};

// 興味なしスポット
const ignoredSpots = new Set();

// 訪問済みスポット
const visitedSpots = new Set();

// 案内中フラグ
let guideActive = false;

// GoogleMap案内中
let guidePaused = false;

let watchId = null;

// スポット情報表示状態
let spotInfoOpen = true;

// =========================
// 利用ログ・自動終了管理
// =========================

// 最後にユーザーが操作した時刻
let lastActivityAt = null;

// 無操作で終了する時間
// 15分 = 15 × 60 × 1000ミリ秒
const INACTIVITY_LIMIT =
    15 * 60 * 1000;

// 自動終了チェック用タイマー
let inactivityTimer = null;

// =========================
// AIチャット履歴
// =========================
let chatHistory = [];

// =========================
// ユーザータイプ
// =========================
let userType = "歴史・文化探訪";

// =========================
// 利用ログ
// =========================

let usageLogId = null;
let usageStartedAt = null;
let usageGuideCount = 0;
let usageGoCount = 0;

// =========================
// スライダー
// =========================

const slider =
  document.getElementById(
    "distanceSlider"
  );

const distanceValue =
  document.getElementById(
    "distanceValue"
  );

slider.addEventListener(
  "input",
  function () {

    triggerDistance =
      Number(slider.value);

    distanceValue.textContent =
      triggerDistance;

  }
);


// =========================
// GPS監視開始
// =========================

function startWatch() {

  if (!navigator.geolocation) {

    alert("GPS非対応");
    return;

  }

watchId =
    navigator.geolocation.watchPosition(
        success,
        error,

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }

  );

  setStatus("GPS監視開始 version4");

}


// =========================
// GPS成功
// =========================

function success(position) {

    const lat =
        position.coords.latitude;

    const lng =
        position.coords.longitude;

    setStatus(
        `現在地: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    );

    // 最初に取得したGPSを開始地点として記録
    if (
        usageLogId !== null &&
        usageStartedAt !== null
    ) {

        setUsageStartLocation(lat, lng);

    }

    processNearestSpot(lat, lng);

}

// =========================
// 利用開始地点を記録
// =========================

let usageStartLocationRecorded = false;

async function setUsageStartLocation(
    lat,
    lng
) {

    if (usageStartLocationRecorded) {
        return;
    }

    usageStartLocationRecorded = true;

    const { error } = await supabaseClient
        .from("usage_logs")
        .update({

            start_lat: lat,
            start_lng: lng

        })
        .eq("id", usageLogId);

    if (error) {

        console.error(
            "開始地点記録エラー:",
            error
        );

        usageStartLocationRecorded = false;

        return;
    }

    console.log(
        "開始地点を記録:",
        lat,
        lng
    );

}

// =========================
// 最寄りスポット処理
// =========================

function processNearestSpot(
  currentLat,
  currentLng
) {
if (guidePaused) {
    console.log("探索停止中");
    return;
}

if (guideActive) {
    console.log("案内中");
    return;
}
  let nearest = null;
  let minDistance = Infinity;

  // 最短距離スポット探索
  for (const spot of spots) {

    if (
      ignoredSpots.has(spot.id)
      ||
      visitedSpots.has(spot.id)
    ) {
      continue;
    }

    const distance = getDistance(
      currentLat,
      currentLng,
      spot.lat,
      spot.lng
    );

    if (distance < minDistance) {

      minDistance = distance;
      nearest = spot;

    }

  }

  if (!nearest) return;

  // UI表示
  document.getElementById(
    "nearestSpot"
  ).textContent =

    `最寄りスポット:
     ${nearest.name}
     (${minDistance.toFixed(1)}m)`;


  // =====================
  // 接近判定
  // =====================

  if (minDistance <= triggerDistance) {

    // 新スポット接近
    if (
      !currentSpot ||
      currentSpot.id !== nearest.id
    ) {

      currentSpot = nearest;

      enterTime = Date.now();

      console.log(
        "接近開始:",
        nearest.name
      );

    }

    const stayMs =
      Date.now() - enterTime;

    document.getElementById(
      "stayTime"
    ).textContent =

      `滞在時間:
       ${(stayMs / 1000).toFixed(1)}秒`;



    // =====================
    // 滞在成立
    // =====================

    if (stayMs >= STAY_TIME) {

      const last =
        lastGuideTime[nearest.id] || 0;

      const now = Date.now();

      // クールタイム確認
      if (
        now - last >
        GUIDE_COOLDOWN
      ) {

        startGuide(nearest);

        lastGuideTime[
          nearest.id
        ] = now;

      }

    }

  }

  // =====================
  // 離脱判定
  // =====================

  else {

    if (
      currentSpot &&
      minDistance >
      LEAVE_DISTANCE
    ) {

      console.log(
        "離脱:",
        currentSpot.name
      );

      currentSpot = null;

      enterTime = null;

      document.getElementById(
        "stayTime"
      ).textContent =
        "滞在時間: 0秒";

    }

  }

}



// =========================
// 案内処理
// =========================
let currentGuideText = "";

async function startGuide(spot){

    guideActive = true;
    currentSpot = spot;

    let guideText = "";

    try{

        guideText = await createGuide(spot);

    }catch(e){

        console.error(e);

        guideText =
            "通信状態が不安定です。もう一度お試しください。";

    }

    currentGuideText = guideText;

    showGuidePanel(guideText, spot);

    // =========================
    // 案内回数を記録
    // =========================
    await incrementGuideCount();

    playNotification();
}

// =========================
// 距離計算
// =========================

function getDistance(
  lat1,
  lng1,
  lat2,
  lng2
) {

  const R = 6371000;

  const dLat =
    toRad(lat2 - lat1);

  const dLng =
    toRad(lng2 - lng1);

  const a =

    Math.sin(dLat / 2) *
    Math.sin(dLat / 2)

    +

    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2))

    *

    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c =

    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;

}


// =========================
// 度→ラジアン
// =========================

function toRad(value) {

  return value *
    Math.PI / 180;

}


// =========================
// ステータス表示
// =========================

function setStatus(text) {

  document.getElementById(
    "status"
  ).textContent = text;

}


// =========================
// GPSエラー
// =========================

function error(err) {

  console.error(err);

  alert("GPS取得失敗");

}

function speakGuide(text){

  // 前回の読み上げを停止
  speechSynthesis.cancel();

  // 音声一覧を取得
  const voices = speechSynthesis.getVoices();

  console.log(voices);

  const speech = new SpeechSynthesisUtterance(text);

  speech.lang = "ja-JP";
  speech.rate = 1.0;
  speech.pitch = 1.0;
  speech.volume = 1.0;

  // 日本語音声があれば設定
  const jaVoice = voices.find(v => v.lang.startsWith("ja"));

  if (jaVoice) {
    speech.voice = jaVoice;
  }

  speech.onerror = (e) => {
    console.log("Speech Error", e);
  };

  speech.onstart = () => {
    console.log("Speech Start");
  };

  speech.onend = () => {
    console.log("Speech End");
  };

  speechSynthesis.speak(speech);
}

function showGuidePanel(
  text,
  spot
){
  document.getElementById(
      "searchPanel"
  ).style.display="none";

  document.getElementById(
    "guidePanel"
  ).style.display = "block";

  document.getElementById(
    "spotImage"
  ).src =
    spot.imageUrl;

  document.getElementById(
    "guideTitle"
  ).textContent =
    spot.name;

  document.getElementById(
    "guideMessage"
  ).textContent =
    text;

    spotInfoOpen = true;

document
.getElementById("spotInfo")
.style.display = "block";

document
.getElementById("toggleSpotBtn")
.textContent =
    `📍 ${spot.name} ▲`;

}


document
.getElementById("goBtn")
.addEventListener("click", function () {

    if (!currentSpot) return;

    updateLastActivity();
    // =========================
    // 「行ってみる」カウント
    // =========================

    usageGoCount++;

    updateUsageLog();

    const url =
        `https://www.google.com/maps/dir/?api=1&destination=${currentSpot.lat},${currentSpot.lng}`;

    visitedSpots.add(currentSpot.id);

    guidePaused = true;

    guideActive = false;

    document
        .getElementById("guidePanel")
        .style.display = "none";

    document
        .getElementById("searchMessage")
        .textContent =
        "Googleマップで目的地へ向かっています";

    document
        .getElementById("resumeScreen")
        .style.display = "block";

    window.open(url, "_blank");

});


document
.getElementById("ignoreBtn")
.addEventListener(
    "click",
    function(){

        // ユーザー操作を記録
        updateLastActivity();

        ignoredSpots.add(
            currentSpot.id
        );

        closeGuide();
    }
);


function closeGuide(){

  document.getElementById(
    "guidePanel"
  ).style.display =
    "none";

  guideActive = false;

  currentSpot = null;

  enterTime = null;

  spotInfoOpen = true;

document.getElementById(
    "searchPanel"
).style.display="block";

document.getElementById(
    "searchMessage"
).textContent=

"おすすめスポットを探しています";

}

// =========================
// AI案内生成
// =========================

async function generateGuide(spot){

    const response = await fetch(

        "https://ここにCloudflare WorkerのURL",

        {

            method:"POST",

            headers:{
                "Content-Type":"application/json"
            },

            body:JSON.stringify({

spot:{

    name:spot.name,

    catchCopy:
        spot.catchCopy,

    topReason:
        spot.topReason,

    highlightPoints:
        spot.highlightPoints,

    ownerExperience:
        spot.ownerExperience,

    recommendFood:
        spot.recommendFood,

    recommendHistory:
        spot.recommendHistory,

    recommendRelax:
        spot.recommendRelax,

    recommendActivity:
        spot.recommendActivity,

    latestTopics:
        spot.latestTopics,

    officialUrl:
        spot.officialUrl,

    bestSeason:
        spot.bestSeason,

    tags:
        spot.tags,

    userType:
        selectedUserType

}
            })

        }

    );

    const data = await response.json();

    return data.guide;

}

// =========================
// 利用ログ開始
// =========================

async function startUsageLog() {

const { data: authData } =
    await supabaseClient.auth.getSession();

console.log(
    "Supabase session:",
    authData.session
);
console.log(
    "SUPABASE KEY:",
    SUPABASE_KEY.substring(0, 20)
);

    usageStartedAt = new Date();

    usageGuideCount = 0;
    usageGoCount = 0;

    try {

        const { data, error } = await supabaseClient
            .from("usage_logs")
            .insert({

                started_at: usageStartedAt.toISOString(),

                language: language,

                user_type: userType,

                start_lat: null,

                start_lng: null,

                go_count: 0,

                duration_seconds: 0,

                guide_count: 0

            })
            .select("id")
            .single();

        if (error) {

            console.error(
                "usage_logs開始記録エラー:",
                error
            );

            return;

        }

        usageLogId = data.id;

        console.log(
            "usage_logs開始:",
            usageLogId
        );

    } catch (e) {

        console.error(
            "usage_logs開始処理エラー:",
            e
        );

    }

}

// =========================
// 利用終了ログ
// =========================
async function endUsageLog() {

    // 利用ログが開始されていない場合
    if (!usageLogId || !usageStartedAt) {

        console.log(
            "終了ログ：usageLogIdがありません"
        );

        return;
    }

    // 終了時刻
    const endedAt = new Date();

    // 利用時間を秒で計算
    const durationSeconds =
        Math.floor(
            (endedAt - usageStartedAt) / 1000
        );

    console.log(
        "利用終了:",
        endedAt.toISOString()
    );

    console.log(
        "利用時間:",
        durationSeconds,
        "秒"
    );

    try {

        const { error } =
            await supabaseClient
                .from("usage_logs")
                .update({

                    ended_at:
                        endedAt.toISOString(),

                    duration_seconds:
                        durationSeconds

                })
                .eq(
                    "id",
                    usageLogId
                );

        if (error) {

            console.error(
                "usage_logs終了記録エラー:",
                error
            );

            return;
        }

        console.log(
            "usage_logs終了記録成功"
        );

        console.log(
            "終了時刻:",
            endedAt.toISOString()
        );

        console.log(
            "利用時間:",
            durationSeconds,
            "秒"
        );

        // 現在の利用ログを終了
        usageLogId = null;
        usageStartedAt = null;

    } catch (e) {

        console.error(
            "usage_logs終了処理エラー:",
            e
        );

    }
}

// =========================
// 最終操作時刻を更新
// =========================
function updateLastActivity() {

    // 利用ログが開始されていなければ何もしない
    if (!usageLogId) {
        return;
    }

    lastActivityAt = Date.now();

    console.log(
        "最終操作時刻を更新:",
        new Date(lastActivityAt).toLocaleTimeString()
    );
}

// =========================
// 無操作時間チェック
// =========================
async function checkInactivity() {

    // 利用ログがなければ終了
    if (!usageLogId) {
        return;
    }

    // 最終操作時刻がなければ終了
    if (!lastActivityAt) {
        return;
    }

    // Googleマップ移動中は終了しない
    if (guidePaused) {

        console.log(
            "Googleマップ移動中のため自動終了チェックを停止"
        );

        return;
    }

    const now = Date.now();

    const inactiveTime =
        now - lastActivityAt;

    console.log(
        "無操作時間:",
        Math.floor(inactiveTime / 1000),
        "秒"
    );

    // 15分以上操作がなければ終了
    if (
        inactiveTime >=
        INACTIVITY_LIMIT
    ) {

        console.log(
            "無操作時間超過。利用を自動終了します。"
        );

        await finishExploration();
    }
}

// =========================
// 自動終了監視開始
// =========================
function startInactivityMonitor() {

    // 既にタイマーがあれば停止
    if (inactivityTimer) {

        clearInterval(
            inactivityTimer
        );
    }

    // 30秒ごとにチェック
    inactivityTimer =
        setInterval(
            checkInactivity,
            30 * 1000
        );

    console.log(
        "自動終了監視を開始しました"
    );
}

// =========================
// 自動終了監視停止
// =========================
function stopInactivityMonitor() {

    if (inactivityTimer) {

        clearInterval(
            inactivityTimer
        );

        inactivityTimer = null;
    }

    lastActivityAt = null;

    console.log(
        "自動終了監視を停止しました"
    );
}

// =========================
// 探索終了処理
// =========================
async function finishExploration() {

    console.log(
        "探索終了処理を開始"
    );

    // 自動終了監視を停止
    stopInactivityMonitor();

    // 利用ログを終了
    await endUsageLog();

    // GPS監視を停止
    if (watchId !== null) {

        navigator.geolocation.clearWatch(
            watchId
        );

        watchId = null;

        console.log(
            "GPS監視を停止しました"
        );
    }

    // 探索状態をリセット
    guidePaused = true;

    guideActive = false;

    currentSpot = null;

    enterTime = null;

    // 画面を閉じる
    document
        .getElementById("guidePanel")
        .style.display = "none";

    document
        .getElementById("resumeScreen")
        .style.display = "none";

    document
        .getElementById("searchPanel")
        .style.display = "none";

    // 開始画面へ
    document
        .getElementById("startPanel")
        .style.display = "";

    console.log(
        "探索を終了しました"
    );
}


// =========================
// guide_count 更新
// =========================
async function incrementGuideCount() {

    // 利用ログがまだ作られていなければ何もしない
    if (!usageLogId) {
        console.log("usageLogIdがありません");
        return;
    }

    usageGuideCount++;

    console.log(
        "guide_count更新:",
        usageGuideCount
    );

    const { error } = await supabaseClient
        .from("usage_logs")
        .update({
            guide_count: usageGuideCount
        })
        .eq("id", usageLogId);

    if (error) {

        console.error(
            "guide_count更新エラー:",
            error
        );

        return;
    }

    console.log(
        "guide_count保存成功:",
        usageGuideCount
    );
}

// =========================
// 利用ログ更新
// =========================

async function updateUsageLog() {

    if (usageLogId === null) {
        return;
    }

    const { error } = await supabaseClient
        .from("usage_logs")
        .update({

            go_count: usageGoCount,

            guide_count: usageGuideCount

        })
        .eq("id", usageLogId);

    if (error) {

        console.error(
            "usage_logs更新エラー:",
            error
        );

        return;
    }

    console.log(
        "usage_logs更新:",
        {
            guide_count:
                usageGuideCount,

            go_count:
                usageGoCount
        }
    );

}

// =========================
// 利用ログ終了
// =========================

async function endUsageLog() {

    if (
        usageLogId === null ||
        usageStartedAt === null
    ) {
        return;
    }

    const endedAt = new Date();

    const durationSeconds =
        Math.floor(
            (endedAt - usageStartedAt) / 1000
        );

    const { error } = await supabaseClient
        .from("usage_logs")
        .update({

            ended_at:
                endedAt.toISOString(),

            duration_seconds:
                durationSeconds,

            go_count:
                usageGoCount,

            guide_count:
                usageGuideCount

        })
        .eq("id", usageLogId);

    if (error) {

        console.error(
            "usage_logs終了記録エラー:",
            error
        );

        return;
    }

    console.log(
        "利用ログ終了:",
        {
            id: usageLogId,
            duration_seconds:
                durationSeconds,
            guide_count:
                usageGuideCount,
            go_count:
                usageGoCount
        }
    );

}

async function initialize() {

  setStatus("スポット読込中...");

  spots = await loadSpots();

  console.log("spots=", spots);

  console.log(spots[0]);

  if (spots.length === 0) {
    setStatus("スポットがありません");
    return;
  }

  setStatus(`${spots.length}件読み込み完了`);

}

async function createGuide(spot) {

  // =====================================
  // ① まず現在のguide-aiで日本語案内を作る
  // =====================================

  const response = await fetch(
    "https://fugibstqzkmzplqrpovn.supabase.co/functions/v1/guide-ai",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        spot: spot,
        userType: userType
      })
    }
  );


  if (!response.ok) {

    throw new Error("AI呼び出し失敗");

  }


  const data = await response.json();


  let guideText = data.guide;


  // =====================================
  // ② 日本語なら、そのまま返す
  // =====================================

  if (language === "ja") {

    return guideText;

  }


  // =====================================
  // ③ 英語ならtranslate-aiへ送る
  // =====================================

  if (language === "en") {

    console.log("英語翻訳を開始します");


    const translateResponse = await fetch(

      "https://fugibstqzkmzplqrpovn.supabase.co/functions/v1/translate-ai",

      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json"

        },

        body: JSON.stringify({

          text: guideText

        })

      }

    );


    if (!translateResponse.ok) {

      console.error(
        "英語翻訳に失敗しました"
      );

      // 翻訳できなかった場合は
      // 日本語案内をそのまま返す
      return guideText;

    }


    const translateData =
      await translateResponse.json();


    console.log(
      "英訳結果:",
      translateData.text
    );


    return translateData.text;

  }


  // =====================================
  // ④ 想定外の場合
  // =====================================

  return guideText;

}

const notificationAudio =
    new Audio("notification.mp3");

function playNotification(){

    console.log("通知音を再生");

    notificationAudio.currentTime = 0;

    notificationAudio.play()
    .catch(err=>{

        console.log(err);

    });

}

async function sendQuestion(){

  const response = await fetch(

    "https://fugibstqzkmzplqrpovn.supabase.co/functions/v1/chat-ai",

    {

      method:"POST",

      headers:{

        "Content-Type":"application/json",

        "Authorization":"Bearer " + SUPABASE_KEY

      },

      body:JSON.stringify({

      spot:currentSpot,

      history:chatHistory,

      userType: userType

      })

    }

  );

  if(!response.ok){

      throw new Error("チャット失敗");

  }

  const data = await response.json();

  return data.answer;

}

initialize();

document
.getElementById("resumeBtn")
.addEventListener("click", function(){

    guidePaused = false;

    guideActive = false;

    currentSpot = null;

    enterTime = null;

    updateLastActivity();
    
    // ナビ画面を閉じる
    document.getElementById("resumeScreen").style.display = "none";

    // 探索画面へ戻る
    document.getElementById("searchPanel").style.display = "block";

    document.getElementById("searchMessage").textContent =
        "おすすめスポットを探しています";

});

// =========================
// ユーザータイプ選択
// =========================

document
.querySelectorAll(".typeBtn")
.forEach(btn=>{

    btn.addEventListener(

        "click",

        function(){

            document
            .querySelectorAll(".typeBtn")
            .forEach(

                b=>b.classList.remove("selected")

            );

            this.classList.add("selected");

            userType =
                this.dataset.type;

            updateLastActivity();

            console.log(userType);

        }

    );

});


window.addEventListener("focus", function () {

    console.log("アプリへ戻りました");

    // Googleマップから戻ってきても
    // 自動では探索を再開しない
    if (!guidePaused) {
        return;
    }

    console.log(
        "Googleマップから復帰しました。"
    );

    console.log(
        "「探索を再開」が押されるまで待機します。"
    );

});

document
.getElementById("toggleSpotBtn")
.addEventListener(

    "click",

    function(){

        const spotInfo =
            document.getElementById("spotInfo");

        const btn =
            document.getElementById("toggleSpotBtn");

        if(spotInfoOpen){

            spotInfo.style.display = "none";

            btn.textContent =
                `📍 ${currentSpot.name} ▼`;

        }else{

            spotInfo.style.display = "block";

            btn.textContent =
                `📍 ${currentSpot.name} ▲`;

        }

        spotInfoOpen = !spotInfoOpen;

    }

);

document
.getElementById("startGuideBtn")
.addEventListener(
    "click",

    async function(){

        console.log(
            "開始ボタンが押されました"
        );

        // =========================
        // 新しい探索を開始
        // =========================

        guidePaused = false;
        guideActive = false;
        currentSpot = null;
        enterTime = null;

        // 利用ログ開始
        await startUsageLog();

        // 最初の操作時刻
        updateLastActivity();

        // 自動終了監視開始
        startInactivityMonitor();

        const audio =
            new Audio("notification.mp3");

        try{

            await audio.play();

            console.log(
                "通知音の再生成功"
            );

            setTimeout(() => {

                audio.pause();

                audio.currentTime = 0;

            },2000);

        }catch(e){

            console.error(
                "通知音エラー",
                e
            );

        }

        document
            .getElementById("startPanel")
            .style.display = "none";

        startWatch();

    }
);

document
.getElementById("sendBtn")
.addEventListener(

"click",

async function(){

    const question =

        document
        .getElementById("question")
        .value;

    if(question===""){

        return;

    }

    updateLastActivity();

    chatHistory.push({

        role:"user",

        text:question

    });

    //案内文折りたたみ処理
    const content =
        document.getElementById("spotInfo");

    content.style.display="none";

    document
    .getElementById("toggleSpotBtn")
    .textContent =
    `📍 ${currentSpot.name} ▼`;

    spotInfoOpen=false;

    const answer =
        await sendQuestion(question);

    chatHistory.push({

        role:"assistant",

        text:answer

    });

    // 履歴は最大20件（user + assistantで1往復2件）
    while(chatHistory.length > 20){

        chatHistory.shift();

    }
    

const historyDiv =
    document.getElementById("chatHistory");

historyDiv.innerHTML += `

<div class="userMessage">

👤 ${question}

</div>

<div class="aiMessage">

🤖 ${answer}

</div>

`;

const history =
    document.getElementById("chatHistory");

history.lastElementChild?.scrollIntoView({

    behavior:"smooth",

    block:"end"

});


document
.getElementById("question")
.value = "";

// 一番下までスクロール
window.scrollTo({

    top: document.body.scrollHeight,

    behavior: "smooth"

});


});

document
.getElementById("toggleDebugBtn")
.addEventListener("click",function(){

    const panel =
        document.getElementById("debugPanel");

    if(panel.style.display==="block"){

        panel.style.display="none";

        this.textContent="⚙";

    }
    else{

        panel.style.display="block";

        this.textContent="❌ 閉じる";

    }

});

// ===============================
// 言語選択
// ===============================

document
.getElementById("japaneseBtn")
.addEventListener("click", function () {

    language = "ja";

    updateLastActivity();

    document
        .getElementById("japaneseBtn")
        .classList.add("selected");

    document
        .getElementById("englishBtn")
        .classList.remove("selected");

    console.log("言語：日本語");

});


document
.getElementById("englishBtn")
.addEventListener("click", function () {

    language = "en";

    updateLastActivity();

    document
        .getElementById("englishBtn")
        .classList.add("selected");

    document
        .getElementById("japaneseBtn")
        .classList.remove("selected");

    console.log("言語：English");

});

window.addEventListener(
    "pagehide",
    function () {

        endUsageLog();

    }
);
