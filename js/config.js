/* =========================================================
   JMG HR Portal — config.js
   الصق رابط الـ Web App الخاص بـ Google Apps Script في API_URL.
   من غيره الموقع مش هيشتغل.
   ========================================================= */
window.JMG_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbw7ESaDFIRjHoB7q5x8-g9Pn0cNFOWpGh9UKbByrSszyGFK6FQd6KepOLO5zr-28PId/exec",          // مثال: "https://script.google.com/macros/s/AKfycb.../exec"
  LOGO: "logo.png",     // لوجو الشركة (ارفعه في نفس فولدر index.html)
  PERMISSION_HOURS: 4,  // رصيد الأذونات الشهري بالساعات
  WEEKEND: [5, 6]       // أيام الويك إند (0 = الأحد ... 5 = الجمعة، 6 = السبت)
};
