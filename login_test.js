(async function() {
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'rayobrian6@gmail.com', password: 'Solarpro1!'})
    });
    const d = await r.json();
    console.log('Login result:', JSON.stringify(d));
    if (d.token) {
      document.cookie = 'auth-token=' + d.token + ';path=/;max-age=86400';
      window.location.href = '/design?projectId=be393208-d878-444e-aafb-cd58b547fce2';
    } else {
      alert('Login failed: ' + JSON.stringify(d));
    }
  } catch(e) {
    alert('Error: ' + e.message);
  }
})();