const startBtn = document.getElementById("startTimerBtn");
const countdown = document.getElementById("countdown");

let timerRunning = false;

startBtn.addEventListener("click", () => {

  if (timerRunning) return;

  timerRunning = true;

  let timeLeft = 10;

  countdown.textContent = `0:${timeLeft}`;

  const timer = setInterval(() => {

    timeLeft--;

    if (timeLeft < 10) {
      countdown.textContent = `0:0${timeLeft}`;
    } else {
      countdown.textContent = `0:${timeLeft}`;
    }

    if (timeLeft <= 0) {

      clearInterval(timer);

      countdown.textContent = "0:00";

      timerRunning = false;

    }

  }, 1000);

});