async function transfer() {
  const destAddress = document.getElementById('destAddr').value;
  const output = window.document.querySelector('#serverRES');
  const queryString = window.location.search;
  const urlParams = new URLSearchParams(queryString);
  const chatID = urlParams.get('id');

  const bodyContent = JSON.stringify({
    dest: destAddress,
    chatID,
  });

  try {
    const response = await fetch('/jetton/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyContent,
    });
    const data = await response.text();
    output.innerText = data;
  } catch (error) {
    output.innerText = 'error';
  }

  return;
}
