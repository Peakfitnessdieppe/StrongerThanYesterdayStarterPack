const form = document.getElementById('pf-unsub-form');
const success = document.getElementById('pf-unsub-success');
const errorNode = form?.querySelector('.pf-unsub-error') || null;
const textareaWrapper = form?.querySelector('.pf-unsub-textarea') || null;
const reasonSelect = form?.querySelector('select[name="reason"]') || null;
const emailInput = form?.querySelector('input[name="email"]') || null;

const UNSUBSCRIBE_WEBHOOK_URL = '/.netlify/functions/promo-unsubscribe';
const POST_UNSUB_REDIRECT = ''; // e.g. 'https://peakfitnessdieppe.ca/thank-you'

function applyPrefill() {
  if (!emailInput) return;
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');
  if (email) {
    emailInput.value = email;
    emailInput.readOnly = true;
  }
}

function toggleNotesField() {
  if (!textareaWrapper || !reasonSelect) return;
  const show = reasonSelect.value === 'other';
  textareaWrapper.toggleAttribute('data-hidden', !show);
  textareaWrapper.style.display = show ? 'grid' : 'none';
}

if (textareaWrapper) {
  textareaWrapper.style.display = 'none';
}

if (reasonSelect) {
  reasonSelect.addEventListener('change', toggleNotesField);
}

toggleNotesField();
applyPrefill();

if (form) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }

    if (errorNode) {
      errorNode.hidden = true;
      errorNode.textContent = '';
    }

    const submitBtn = form.querySelector('.pf-unsub-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.dataset.originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'Processing…';
    }

    const payload = Object.fromEntries(new FormData(form).entries());
    payload.timestamp = new Date().toISOString();
    payload.source = 'recipe_promo_popup';
    payload.type = 'unsubscribe';

    try {
      const response = await fetch(UNSUBSCRIBE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Unsubscribe failed: ${response.status}`);
      }

      form.hidden = true;
      if (success) success.hidden = false;

      if (POST_UNSUB_REDIRECT) {
        setTimeout(() => {
          window.location.href = POST_UNSUB_REDIRECT;
        }, 1800);
      }
    } catch (error) {
      console.error('unsubscribe error', error);
      if (errorNode) {
        errorNode.textContent = 'Something went wrong. Please try again or email info@peakfitnessdieppe.ca.';
        errorNode.hidden = false;
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = submitBtn.dataset.originalLabel || 'Unsubscribe me';
      }
    }
  });
}
