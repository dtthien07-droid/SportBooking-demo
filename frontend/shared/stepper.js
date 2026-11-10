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

  function getStepState(step, currentStep) {
    if (!Number.isInteger(step) || step < 1 || step > steps.length
        || !Number.isInteger(currentStep) || currentStep < 1 || currentStep > steps.length) {
      throw new RangeError('Bước đặt sân phải là số nguyên từ 1 đến 3.');
    }
    if (step < currentStep) return 'completed';
    if (step === currentStep) return 'current';
    return 'upcoming';
  }

  function render(mount, currentStep, { previousHref = '' } = {}) {
    if (!mount || typeof mount !== 'object') {
      throw new TypeError('Không tìm thấy vị trí hiển thị thanh bước.');
    }
    const stateByStep = steps.map((_, index) => getStepState(index + 1, currentStep));
    const progress = `${((currentStep - 1) / (steps.length - 1)) * 100}%`;
    const safePreviousHref = previousHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const items = steps.map((title, index) => {
      const step = index + 1;
      const state = stateByStep[index];
      const isCurrent = state === 'current';
      const isCompleted = state === 'completed';
      const side = step === 1 ? 'pl-space-xs' : step === 3 ? 'pr-space-xs' : '';
      const alignment = step === 1 ? '' : step === 2 ? 'justify-center' : 'justify-end';
      const textAlignment = step === 3 ? 'text-right' : '';
      const iconClass = isCompleted || isCurrent
        ? 'bg-primary text-on-primary shadow-sm'
        : 'bg-surface-container-high text-on-surface-variant';
      const tagClass = isCurrent
        ? 'text-primary'
        : isCompleted
          ? 'text-on-surface-variant'
          : 'text-on-surface-variant';
      const titleClass = isCurrent || isCompleted
        ? 'text-on-surface'
        : 'text-on-surface-variant';
      const icon = isCompleted
        ? '<span class="material-symbols-outlined text-xl" aria-hidden="true">check</span>'
        : String(step);
      const commonClass = `booking-stepper__item flex items-center gap-space-sm z-10 ${alignment} ${side}`;
      let control;
      if (isCurrent) {
        control = `<button type="button" class="${commonClass} booking-stepper__control cursor-default" aria-current="step">`;
      } else if (step === 1 && currentStep === 2 && previousHref) {
        control = `<a class="${commonClass} booking-stepper__control cursor-pointer" href="${safePreviousHref}">`;
      } else {
        control = `<span class="${commonClass} cursor-default" aria-disabled="true">`;
      }
      const closingTag = isCurrent || (step === 1 && currentStep === 2 && previousHref)
        ? (isCurrent ? '</button>' : '</a>')
        : '</span>';
      const tagText = isCurrent ? 'text-primary' : tagClass;
      const weight = isCurrent || isCompleted ? 'font-bold' : 'font-medium';
      return `${control}
        <span class="booking-stepper__icon w-10 h-10 rounded-xl ${iconClass} flex items-center justify-center font-bold text-base transition-all">${icon}</span>
        <span class="booking-stepper__label flex flex-col min-w-0 ${textAlignment}">
          <span class="text-[11px] ${tagText} uppercase font-bold tracking-wider">Bước ${step}</span>
          <span class="text-sm ${weight} ${titleClass} truncate">${title}</span>
        </span>
      ${closingTag}`;
    }).join('');

    mount.innerHTML = `<div class="booking-stepper mb-space-lg bg-surface-container-lowest p-space-md rounded-2xl shadow-sm border border-gray-100" aria-label="Tiến trình đặt sân">
      <div class="grid grid-cols-3 items-center relative">
        <div class="booking-stepper__track absolute left-[16.6%] right-[16.6%] top-1/2 -translate-y-1/2 h-1 bg-surface-container-high rounded-full -z-0" aria-hidden="true">
          <div class="h-full bg-primary rounded-full transition-all duration-300" style="width: ${progress}"></div>
        </div>
        ${items}
      </div>
    </div>`;
  }

  return { getStepState, render };
}));
