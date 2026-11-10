'use strict';

(function initializeStepper(root, factory) {
  const stepper = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = stepper;
  } else {
    root.SportBookingStepper = stepper;
  }
}(typeof window !== 'undefined' ? window : globalThis, () => {
  const steps = [
    'Xác nhận thông tin',
    'Thanh toán &amp; Giữ chỗ',
    'Hoàn tất đặt lịch'
  ];
  const completeValues = new Set([4, 'complete', 'done', 'all-complete']);

  function isComplete(currentStep) {
    return completeValues.has(currentStep);
  }

  function validateCurrentStep(currentStep) {
    if (isComplete(currentStep)) return;
    if (!Number.isInteger(currentStep) || currentStep < 1 || currentStep > steps.length) {
      throw new RangeError('Bước đặt sân phải là số nguyên từ 1 đến 3 hoặc complete.');
    }
  }

  function getStepState(step, currentStep) {
    if (!Number.isInteger(step) || step < 1 || step > steps.length) {
      throw new RangeError('Bước đặt sân phải là số nguyên từ 1 đến 3.');
    }
    validateCurrentStep(currentStep);
    if (isComplete(currentStep) || step < currentStep) return 'completed';
    if (step === currentStep) return 'current';
    return 'upcoming';
  }

  function escapeAttribute(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function itemContent(step, state, title) {
    const completed = state === 'completed';
    const numberOrCheck = completed
      ? '<svg class="booking-stepper__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'
      : String(step);
    const status = completed
      ? 'Đã xong'
      : state === 'current' ? 'Đang thực hiện' : 'Chưa tới';
    const statusColor = state === 'upcoming' ? 'text-on-surface-variant' : 'text-primary';
    const circle = `booking-stepper__circle ${completed
      ? 'bg-primary text-on-primary'
      : state === 'current'
        ? 'bg-primary-container text-on-primary-container'
        : 'bg-surface-container-high text-on-surface-variant'}`;

    return `<span class="${circle}" aria-hidden="true">${numberOrCheck}</span>
      <span class="booking-stepper__label">
        <span class="booking-stepper__title">${title}</span>
        <span class="booking-stepper__status ${statusColor}">${status}</span>
      </span>`;
  }

  function render(mount, currentStep, { previousHref = '' } = {}) {
    if (!mount || typeof mount !== 'object') {
      throw new TypeError('Không tìm thấy vị trí hiển thị thanh bước.');
    }
    validateCurrentStep(currentStep);
    const completedSteps = isComplete(currentStep) ? steps.length : currentStep - 1;
    const items = steps.map((title, index) => {
      const step = index + 1;
      const state = getStepState(step, currentStep);
      const current = state === 'current' ? ' aria-current="step"' : '';
      const content = itemContent(step, state, title);
      const href = step === 1 && currentStep === 2 && previousHref
        ? ` href="${escapeAttribute(previousHref)}"`
        : '';
      const tag = href ? 'a' : 'span';
      const linkAttrs = href ? ' class="booking-stepper__link"' : '';
      const accessibleTitle = title.replace(/&amp;/g, '&');
      const accessibleStatus = state === 'completed'
        ? 'Đã xong'
        : state === 'current' ? 'Đang thực hiện' : 'Chưa tới';
      const label = escapeAttribute(`Bước ${step}: ${accessibleStatus}, ${accessibleTitle}`);
      return `<li class="booking-stepper__item" aria-label="${label}"${current}><${tag}${linkAttrs}${href}>${content}</${tag}></li>`;
    }).join('');
    const connectors = [1, 2].map((step) => {
      const complete = getStepState(step, currentStep) === 'completed';
      return `<span class="booking-stepper__connector ${complete
        ? 'bg-primary'
        : 'bg-surface-container-high'}"></span>`;
    }).join('');

    mount.innerHTML = `<nav class="booking-stepper mb-space-lg bg-surface-container-lowest p-space-md rounded-2xl shadow-sm border border-gray-100" aria-label="Tiến trình đặt sân">
      <div class="booking-stepper__layout">
        <div class="booking-stepper__connectors" aria-hidden="true">${connectors}</div>
        <ol class="booking-stepper__steps">${items}</ol>
      </div>
    </nav>`;
    mount.dataset.currentStep = String(currentStep);
    mount.dataset.completedSteps = String(completedSteps);
  }

  return { getStepState, render };
}));
