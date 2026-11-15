'use strict';

(() => {
  const API = {
    login: '/api/v1/auth/login',
    register: '/api/v1/auth/register',
    logout: '/api/v1/auth/logout',
    me: '/api/v1/auth/me',
    profile: '/api/v1/users/me',
    password: '/api/v1/users/me/password'
  };
  const body = document.body;
  const page = body.dataset.page;
  const notice = document.querySelector('[data-notice]');

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) {
      return null;
    }
    if (response.status === 204) {
      return null;
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      const invalidResponse = new Error('Máy chủ trả về phản hồi không hợp lệ.');
      invalidResponse.status = response.status;
      throw invalidResponse;
    }
    if (!response.ok) {
      const error = new Error(data && data.error && data.error.message
        ? data.error.message
        : 'Yêu cầu chưa thể hoàn tất.');
      error.status = response.status;
      error.code = data && data.error ? data.error.code : undefined;
      throw error;
    }
    return data;
  }

  function showNotice(message, kind = 'error') {
    if (!notice) return;
    notice.textContent = message;
    notice.dataset.kind = kind;
    notice.hidden = false;
  }

  function clearNotice() {
    if (!notice) return;
    notice.textContent = '';
    delete notice.dataset.kind;
    notice.hidden = true;
  }

  function setFieldError(form, name, message) {
    const field = form.elements.namedItem(name);
    const target = form.querySelector(`[data-field-error="${name}"]`);
    if (field && 'setAttribute' in field) {
      if (message) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    if (target) target.textContent = message || '';
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('[data-field-error]').forEach((target) => {
      target.textContent = '';
    });
    form.querySelectorAll('[aria-invalid="true"]').forEach((field) => {
      field.removeAttribute('aria-invalid');
    });
  }

  function setLoading(button, loading) {
    button.disabled = loading;
    button.textContent = loading ? button.dataset.loadingLabel : button.dataset.idleLabel;
    button.setAttribute('aria-busy', String(loading));
  }

  function formValues(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function setErrors(form, errors) {
    Object.entries(errors).forEach(([name, message]) => setFieldError(form, name, message));
  }

  function validateEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;
  }

  function validatePhone(value) {
    return /^\+?\d{8,15}$/.test(value.trim().replace(/[\s().-]/g, ''));
  }

  function passwordWithinLimit(value) {
    return new TextEncoder().encode(value).length <= 72;
  }

  function validateRegister(values) {
    const errors = {};
    if (!values.fullName.trim() || values.fullName.trim().length > 120) {
      errors.fullName = 'Vui lòng nhập họ tên (tối đa 120 ký tự).';
    }
    if (!validateEmail(values.email)) errors.email = 'Vui lòng nhập email hợp lệ.';
    if (!validatePhone(values.phone)) errors.phone = 'Số điện thoại cần có từ 8 đến 15 chữ số.';
    if (values.password.length < 8 || !passwordWithinLimit(values.password)) {
      errors.password = 'Mật khẩu cần có ít nhất 8 ký tự và tối đa 72 byte UTF-8.';
    }
    if (values.password !== values.confirmPassword) errors.confirmPassword = 'Mật khẩu nhập lại chưa khớp.';
    if (!values.gender) errors.gender = 'Vui lòng chọn giới tính.';
    if (!values.favorite_sport) errors.favorite_sport = 'Vui lòng chọn môn thể thao.';
    if (!values.skill_level) errors.skill_level = 'Vui lòng chọn trình độ.';
    if (!values.termsAccepted) errors.termsAccepted = 'Bạn cần đồng ý với điều khoản để đăng ký.';
    return errors;
  }

  function setLoginErrors(form, error) {
    if (error.status === 400) {
      setErrors(form, {
        email: 'Vui lòng kiểm tra email và mật khẩu.',
        password: 'Vui lòng nhập mật khẩu.'
      });
      showNotice('Thông tin đăng nhập chưa hợp lệ. Vui lòng kiểm tra các trường bên dưới.');
    } else if (error.status === 401) {
      setFieldError(form, 'password', 'Email hoặc mật khẩu không chính xác.');
      showNotice('Không thể đăng nhập bằng thông tin này. Hãy kiểm tra email và mật khẩu.');
    } else if (error.status === 403 && error.code === 'ACCOUNT_LOCKED') {
      showNotice('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
    } else if (error.status === 403) {
      showNotice('Không thể đăng nhập bằng tài khoản này. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
    } else if (error.status === 423) {
      showNotice('Tài khoản đang tạm khóa do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.');
    } else {
      showNotice('Đăng nhập chưa thành công. Vui lòng thử lại sau.');
    }
  }

  function setRegisterErrors(form, error) {
    if (error.status === 400) {
      const message = (error.message || '').toLowerCase();
      const errors = {};
      if (message.includes('full name')) errors.fullName = 'Vui lòng nhập họ tên hợp lệ.';
      if (message.includes('email')) errors.email = 'Vui lòng kiểm tra địa chỉ email.';
      if (message.includes('phone')) errors.phone = 'Vui lòng kiểm tra số điện thoại.';
      if (message.includes('password')) errors.password = 'Mật khẩu cần có ít nhất 8 ký tự.';
      if (message.includes('terms')) errors.termsAccepted = 'Bạn cần đồng ý với điều khoản để đăng ký.';
      if (Object.keys(errors).length === 0) {
        showNotice('Thông tin đăng ký chưa hợp lệ. Vui lòng kiểm tra các trường bên dưới.');
      } else {
        setErrors(form, errors);
        showNotice('Vui lòng kiểm tra lại thông tin đăng ký.');
      }
    } else if (error.status === 409) {
      setFieldError(form, 'email', 'Email hoặc số điện thoại này đã được đăng ký.');
      setFieldError(form, 'phone', 'Email hoặc số điện thoại này đã được đăng ký.');
      showNotice('Email hoặc số điện thoại đã được sử dụng. Hãy kiểm tra lại hoặc đăng nhập.');
    } else {
      showNotice('Đăng ký chưa thành công. Vui lòng thử lại sau.');
    }
  }

  function setProfileErrors(form, error) {
    const message = (error.message || '').toLowerCase();
    if (error.status === 400) {
      const errors = {};
      if (message.includes('full name')) errors.fullName = 'Vui lòng nhập họ tên hợp lệ.';
      if (message.includes('phone')) errors.phone = 'Vui lòng nhập số điện thoại hợp lệ.';
      if (message.includes('gender')) errors.gender = 'Vui lòng chọn giới tính hợp lệ.';
      if (message.includes('sport')) errors.favorite_sport = 'Vui lòng chọn môn thể thao hợp lệ.';
      if (message.includes('skill')) errors.skill_level = 'Vui lòng chọn trình độ hợp lệ.';
      if (form.dataset.form === 'password' && message.includes('password')) {
        errors.newPassword = 'Mật khẩu mới cần có ít nhất 8 ký tự và tối đa 72 byte UTF-8.';
      }
      if (Object.keys(errors).length) setErrors(form, errors);
      showNotice('Thông tin chưa hợp lệ. Vui lòng kiểm tra các trường bên dưới.');
    } else if (error.status === 409) {
      setFieldError(form, 'phone', 'Số điện thoại này đã được sử dụng.');
      showNotice('Số điện thoại này đã được đăng ký bởi tài khoản khác.');
    } else if (error.status === 401 && form.dataset.form === 'password') {
      setFieldError(form, 'currentPassword', 'Mật khẩu hiện tại không chính xác.');
      showNotice('Không thể đổi mật khẩu. Vui lòng kiểm tra mật khẩu hiện tại.');
    } else if (error.status === 403) {
      showNotice('Tài khoản đã bị quản trị viên khóa. Vui lòng liên hệ quản trị viên.');
    } else {
      showNotice('Không thể lưu thay đổi. Vui lòng thử lại sau.');
    }
  }

  function redirectToLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function setBackBehavior() {
    const back = document.querySelector('[data-back]');
    if (!back) return;
    back.addEventListener('click', (event) => {
      const referrer = document.referrer;
      if (window.history.length > 1 && referrer) {
        try {
          if (new URL(referrer).origin === window.location.origin) {
            event.preventDefault();
            window.history.back();
          }
        } catch (error) {
          // Keep the fallback link when the referrer cannot be parsed.
        }
      }
    });
  }

  function showQueryNotice() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('locked') === '1') {
      showNotice('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
    } else if (params.get('accessDenied') === '1') {
      showNotice('Bạn không có quyền truy cập');
    } else if (params.get('registered') === '1') {
      showNotice('Tài khoản đã được tạo. Đăng nhập để tiếp tục.', 'success');
    } else if (params.get('loggedOut') === '1') {
      showNotice('Bạn đã đăng xuất thành công.', 'success');
    }
  }

  function bindLogin() {
    const form = document.querySelector('[data-form="login"]');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearNotice();
      clearFieldErrors(form);
      const values = formValues(form);
      const errors = {};
      if (!validateEmail(values.email || '')) errors.email = 'Vui lòng nhập email hợp lệ.';
      if (!values.password) errors.password = 'Vui lòng nhập mật khẩu.';
      if (Object.keys(errors).length) {
        setErrors(form, errors);
        showNotice('Vui lòng nhập email và mật khẩu hợp lệ.');
        return;
      }

      const button = form.querySelector('[data-submit]');
      setLoading(button, true);
      try {
        const result = await request(API.login, {
          method: 'POST',
          body: JSON.stringify({ email: values.email.trim(), password: values.password })
        });
        if (!result || !result.user) {
          throw new Error('Đăng nhập thành công nhưng máy chủ không trả thông tin tài khoản.');
        }
        window.location.assign(
          window.SportBookingAdminState.getPostLoginDestination(result.user.role)
        );
      } catch (error) {
        setLoginErrors(form, error);
        setLoading(button, false);
      }
    });
  }

  function bindRegister() {
    const form = document.querySelector('[data-form="register"]');
    bindRegistrationChoices(form);
    bindLegalReadGate(form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearNotice();
      clearFieldErrors(form);
      const values = formValues(form);
      const errors = validateRegister(values);
      if (Object.keys(errors).length) {
        setErrors(form, errors);
        showNotice('Vui lòng kiểm tra lại thông tin đăng ký.');
        return;
      }

      const button = form.querySelector('[data-submit]');
      setLoading(button, true);
      try {
        await request(API.register, {
          method: 'POST',
          body: JSON.stringify({
            fullName: values.fullName.trim(),
            email: values.email.trim(),
            phone: values.phone.trim(),
            password: values.password,
            gender: values.gender,
            favorite_sport: values.favorite_sport,
            skill_level: values.skill_level,
            termsAccepted: values.termsAccepted === 'on'
          })
        });
        window.location.assign('/dang-nhap.html?registered=1');
      } catch (error) {
        setRegisterErrors(form, error);
        setLoading(button, false);
      }
    });
  }

  function bindRegistrationChoices(form) {
    const groups = [
      {
        name: 'gender',
        selector: '.gender-card',
        selectedClasses: ['bg-surface-container-lowest', 'shadow-md', 'border-primary/20'],
        unselectedClasses: ['bg-surface-container-low', 'shadow-sm', 'border-transparent'],
        updateCard(card, selected) {
          const icon = card.querySelector('.w-12');
          const indicator = card.querySelector('.check-indicator');
          icon.classList.toggle('text-primary', selected);
          icon.classList.toggle('text-on-surface-variant', !selected);
          indicator.classList.toggle('hidden', !selected);
          indicator.classList.toggle('flex', selected);
        }
      },
      {
        name: 'favorite_sport',
        selector: '.sport-chip',
        selectedClasses: ['bg-primary-container', 'text-on-primary', 'shadow-sm'],
        unselectedClasses: ['bg-surface-container', 'text-on-surface-variant'],
        updateCard(card, selected) {
          const indicator = card.querySelector('.sport-choice-indicator');
          indicator.classList.toggle('hidden', !selected);
          indicator.classList.toggle('flex', selected);
        }
      },
      {
        name: 'skill_level',
        selector: '.level-card',
        selectedClasses: ['bg-surface-container-lowest', 'shadow-md', 'active-level', 'border-primary/20'],
        unselectedClasses: ['bg-surface', 'hover:bg-surface-container-high', 'shadow-sm', 'border-transparent'],
        updateCard(card, selected) {
          const icon = card.querySelector('.level-icon');
          const title = card.querySelector('h4');
          const badge = card.querySelector('.select-badge');
          const badgeIcon = badge.querySelector('svg[data-sb-icon]');
          const footer = card.querySelector('.mt-space-md.pt-space-xs');
          const footerLabel = footer.children[0];
          const footerIcon = footerLabel.querySelector('svg[data-sb-icon]');

          icon.classList.toggle('bg-primary-container', selected);
          icon.classList.toggle('text-on-primary', selected);
          icon.classList.toggle('shadow-sm', selected);
          icon.classList.toggle('bg-surface-container-highest', !selected);
          icon.classList.toggle('text-on-surface-variant', !selected);
          title.classList.toggle('text-primary', selected);
          title.classList.toggle('text-on-surface', !selected);
          badge.classList.toggle('bg-primary', selected);
          badge.classList.toggle('text-on-primary', selected);
          badge.classList.toggle('bg-surface-container', !selected);
          badge.classList.toggle('text-on-surface-variant', !selected);
          window.SportBookingIcons.setIcon(
            badgeIcon,
            selected ? 'check' : 'radio_button_unchecked'
          );
          footer.classList.toggle('text-on-surface', selected);
          footer.classList.toggle('text-on-surface-variant', !selected);
          footerLabel.classList.toggle('text-primary', selected);
          footerLabel.classList.toggle('font-medium', selected);
          footerIcon.classList.toggle('text-secondary', !selected);
        }
      }
    ];

    groups.forEach((group) => {
      const cards = Array.from(form.querySelectorAll(group.selector));
      const update = () => {
        cards.forEach((card) => {
          const radio = card.querySelector(`input[type="radio"][name="${group.name}"]`);
          const selected = radio.checked;
          group.selectedClasses.forEach((className) => card.classList.toggle(className, selected));
          group.unselectedClasses.forEach((className) => card.classList.toggle(className, !selected));
          group.updateCard(card, selected);
        });
      };

      form.querySelectorAll(`input[type="radio"][name="${group.name}"]`).forEach((radio) => {
        radio.addEventListener('change', update);
      });
      update();
    });
  }

  function bindLegalReadGate(form) {
    const checkbox = form.querySelector('input[name="termsAccepted"][disabled]');
    if (!checkbox) return;

    const documents = Array.from(form.querySelectorAll('.sb-legal-document'));
    if (documents.length !== 2) {
      throw new Error('Registration must provide both legal documents before enabling consent.');
    }

    const openedDocuments = new Set();
    const readDocuments = new Set();
    const updateCheckbox = () => {
      checkbox.disabled = documents.some((document) => (
        !openedDocuments.has(document.id) || !readDocuments.has(document.id)
      ));
    };

    documents.forEach((document) => {
      const content = document.querySelector('.sb-legal-content');
      if (!content) {
        throw new Error(`Legal document ${document.id} is missing its scrollable content.`);
      }

      const recordReading = () => {
        if (!document.open) return;
        openedDocuments.add(document.id);
        if (content.scrollTop + content.clientHeight >= content.scrollHeight - 1) {
          readDocuments.add(document.id);
        }
        updateCheckbox();
      };

      document.addEventListener('toggle', recordReading);
      content.addEventListener('scroll', recordReading);
    });
  }

  function renderProfile(user) {
    const form = document.querySelector('[data-form="profile"]');
    form.elements.fullName.value = user.fullName || '';
    form.elements.email.value = user.email || '';
    form.elements.phone.value = user.phone || '';
    form.elements.gender.value = user.gender || '';
    form.elements.skillLevel.value = user.skillLevel || '';
    const roleLabel = user.role === 'ADMIN' ? 'Quản trị viên' : 'Người dùng';
    document.querySelector('[data-profile-role]').textContent = `Vai trò: ${roleLabel}`;
    document.querySelector('[data-profile-loading]').hidden = true;
    document.querySelector('[data-profile-error]').hidden = true;
    document.querySelector('[data-profile-content]').hidden = false;
  }

  async function loadProfile() {
    const loading = document.querySelector('[data-profile-loading]');
    const errorState = document.querySelector('[data-profile-error]');
    const content = document.querySelector('[data-profile-content]');
    loading.hidden = false;
    errorState.hidden = true;
    content.hidden = true;
    clearNotice();
    try {
      const user = await window.SportBookingHeaderReady;
      if (!user) throw new Error('Máy chủ chưa trả hồ sơ tài khoản.');
      renderProfile(user);
    } catch (error) {
      if (error.status === 401 && error.code === 'UNAUTHENTICATED') {
        redirectToLogin();
        return;
      }
      loading.hidden = true;
      errorState.hidden = false;
      showNotice(error.status === 403
        ? 'Tài khoản đã bị quản trị viên khóa. Vui lòng liên hệ quản trị viên.'
        : 'Không thể tải hồ sơ. Hãy thử tải lại; dữ liệu chưa được thay đổi.');
    }
  }

  function bindProfile() {
    document.querySelector('[data-retry]').addEventListener('click', loadProfile);
    const profileForm = document.querySelector('[data-form="profile"]');
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearNotice();
      clearFieldErrors(profileForm);
      const values = formValues(profileForm);
      const errors = {};
      if (!values.fullName.trim() || values.fullName.trim().length > 120) {
        errors.fullName = 'Vui lòng nhập họ tên (tối đa 120 ký tự).';
      }
      if (!validatePhone(values.phone)) errors.phone = 'Số điện thoại cần có từ 8 đến 15 chữ số.';
      if (Object.keys(errors).length) {
        setErrors(profileForm, errors);
        showNotice('Vui lòng kiểm tra lại thông tin hồ sơ.');
        return;
      }
      const button = profileForm.querySelector('[data-submit]');
      setLoading(button, true);
      try {
        const result = await request(API.profile, {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: values.fullName.trim(),
            phone: values.phone.trim(),
            gender: values.gender || null,
            skillLevel: values.skillLevel || null
          })
        });
        if (!result || !result.user) throw new Error('Máy chủ chưa trả hồ sơ đã cập nhật.');
        renderProfile(result.user);
        showNotice('Đã cập nhật hồ sơ.', 'success');
      } catch (error) {
        if (error.status === 401 && error.code === 'UNAUTHENTICATED') {
          redirectToLogin();
          return;
        }
        setProfileErrors(profileForm, error);
      } finally {
        setLoading(button, false);
      }
    });

    const passwordForm = document.querySelector('[data-form="password"]');
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearNotice();
      clearFieldErrors(passwordForm);
      const values = formValues(passwordForm);
      const errors = {};
      if (!values.currentPassword) errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
      if (values.newPassword.length < 8 || !passwordWithinLimit(values.newPassword)) {
        errors.newPassword = 'Mật khẩu mới cần có ít nhất 8 ký tự và tối đa 72 byte UTF-8.';
      }
      if (values.newPassword !== values.confirmNewPassword) {
        errors.confirmNewPassword = 'Mật khẩu nhập lại chưa khớp.';
      }
      if (Object.keys(errors).length) {
        setErrors(passwordForm, errors);
        showNotice('Vui lòng kiểm tra lại thông tin đổi mật khẩu.');
        return;
      }
      const button = passwordForm.querySelector('[data-submit]');
      setLoading(button, true);
      try {
        await request(API.password, {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword: values.currentPassword,
            newPassword: values.newPassword
          })
        });
        passwordForm.reset();
        showNotice('Đã đổi mật khẩu thành công.', 'success');
      } catch (error) {
        if (error.status === 401 && error.code === 'UNAUTHENTICATED') {
          redirectToLogin();
          return;
        }
        setProfileErrors(passwordForm, error);
      } finally {
        setLoading(button, false);
      }
    });

    loadProfile();
  }

  setBackBehavior();
  if (page === 'login') {
    showQueryNotice();
    bindLogin();
  } else if (page === 'register') {
    bindRegister();
  } else if (page === 'profile') {
    bindProfile();
  }
})();
