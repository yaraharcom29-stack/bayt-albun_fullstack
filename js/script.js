(() => {
  'use strict';

  const API = {
    menu: '/api/menu',
    orders: '/api/orders',
    contact: '/api/contact',
    newsletter: '/api/newsletter'
  };

  const navbar = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  const navAnchors = [...navLinks.querySelectorAll('a')];

  const updateNavbar = () => {
    navbar.classList.toggle('scrolled', window.scrollY > 60);
  };

  const closeMenu = (returnFocus = false) => {
    navLinks.classList.remove('open');
    hamburger.classList.remove('active');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'فتح القائمة');
    document.body.classList.remove('menu-open');
    if (returnFocus) hamburger.focus();
  };

  const openMenu = () => {
    navLinks.classList.add('open');
    hamburger.classList.add('active');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'إغلاق القائمة');
    document.body.classList.add('menu-open');
    navAnchors[0]?.focus();
  };

  updateNavbar();
  window.addEventListener('scroll', updateNavbar, { passive: true });

  hamburger.addEventListener('click', () => {
    navLinks.classList.contains('open') ? closeMenu() : openMenu();
  });

  navAnchors.forEach(anchor => anchor.addEventListener('click', () => closeMenu()));

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navLinks.classList.contains('open')) {
      closeMenu(true);
      return;
    }

    if (event.key === 'Tab' && navLinks.classList.contains('open')) {
      const focusable = [...navAnchors, hamburger];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 840) closeMenu();
  });

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
    revealEls.forEach(element => observer.observe(element));
  } else {
    revealEls.forEach(element => element.classList.add('visible'));
  }

  // Accessible menu tabs
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];

  const activateTab = tab => {
    tabs.forEach(item => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach(panel => {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let newIndex = index;
      if (event.key === 'ArrowRight') newIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowLeft') newIndex = (index + 1) % tabs.length;
      if (event.key === 'Home') newIndex = 0;
      if (event.key === 'End') newIndex = tabs.length - 1;
      tabs[newIndex].focus();
      activateTab(tabs[newIndex]);
    });
  });

  // ---------------- ORDER CART ----------------
  const menuCatalog = new Map();
  const cart = new Map();
  const cartItems = document.getElementById('cartItems');
  const cartCount = document.getElementById('cartCount');
  const cartTotal = document.getElementById('cartTotal');
  const addButtons = [...document.querySelectorAll('[data-add-product]')];
  const orderForm = document.getElementById('orderForm');
  const orderStatus = document.getElementById('orderStatus');
  const orderSubmit = document.getElementById('orderSubmit');
  const fulfillmentType = document.getElementById('fulfillmentType');
  const orderAddressGroup = document.getElementById('orderAddressGroup');
  const orderAddress = document.getElementById('orderAddress');
  const numberFormat = new Intl.NumberFormat('ar-SA');

  const loadCatalog = async () => {
    try {
      const response = await fetch(API.menu, { headers: { Accept: 'application/json' } });
      const data = await parseApiResponse(response);
      data.items.forEach(item => menuCatalog.set(item.id, item));
      addButtons.forEach(button => { button.disabled = false; });
      renderCart();
    } catch (error) {
      console.error('Menu API unavailable:', error);
      addButtons.forEach(button => { button.disabled = true; });
      orderStatus.textContent = 'تعذر الاتصال بالخادم. شغّلي الموقع عن طريق Node.js ثم حاولي مرة أخرى.';
    }
  };

  addButtons.forEach(button => {
    button.disabled = true;
    button.addEventListener('click', () => {
      const productId = button.dataset.addProduct;
      if (!menuCatalog.has(productId)) return;
      cart.set(productId, Math.min((cart.get(productId) || 0) + 1, 20));
      renderCart();
      const original = button.textContent;
      button.textContent = 'تمت الإضافة ✓';
      button.classList.add('added');
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove('added');
      }, 900);
    });
  });

  cartItems.addEventListener('click', event => {
    const control = event.target.closest('[data-cart-action]');
    if (!control) return;
    const productId = control.dataset.productId;
    const action = control.dataset.cartAction;
    const current = cart.get(productId) || 0;

    if (action === 'increase') cart.set(productId, Math.min(current + 1, 20));
    if (action === 'decrease') {
      if (current <= 1) cart.delete(productId);
      else cart.set(productId, current - 1);
    }
    if (action === 'remove') cart.delete(productId);
    renderCart();
  });

  function renderCart() {
    cartItems.replaceChildren();

    if (!cart.size) {
      const empty = document.createElement('p');
      empty.className = 'cart-empty';
      empty.textContent = 'السلة فارغة. اختاري صنفًا من المنيو واضغطي «أضف للطلب».';
      cartItems.appendChild(empty);
      cartCount.textContent = '0';
      cartTotal.textContent = '0';
      return;
    }

    let itemCount = 0;
    let total = 0;

    for (const [productId, quantity] of cart.entries()) {
      const product = menuCatalog.get(productId);
      if (!product) continue;
      itemCount += quantity;
      total += product.price * quantity;

      const row = document.createElement('div');
      row.className = 'cart-row';

      const details = document.createElement('div');
      details.className = 'cart-row-info';
      const name = document.createElement('strong');
      name.textContent = product.name;
      const price = document.createElement('span');
      price.textContent = `${numberFormat.format(product.price * quantity)} ر.س`;
      details.append(name, price);

      const controls = document.createElement('div');
      controls.className = 'cart-controls';
      controls.append(
        makeCartButton('+', 'increase', productId, `زيادة كمية ${product.name}`),
        makeQuantityBadge(quantity),
        makeCartButton('−', 'decrease', productId, `تقليل كمية ${product.name}`),
        makeCartButton('حذف', 'remove', productId, `حذف ${product.name}`, 'cart-remove')
      );

      row.append(details, controls);
      cartItems.appendChild(row);
    }

    cartCount.textContent = numberFormat.format(itemCount);
    cartTotal.textContent = numberFormat.format(total);
  }

  function makeCartButton(text, action, productId, ariaLabel, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cart-control ${extraClass}`.trim();
    button.dataset.cartAction = action;
    button.dataset.productId = productId;
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = text;
    return button;
  }

  function makeQuantityBadge(quantity) {
    const span = document.createElement('span');
    span.className = 'cart-quantity';
    span.textContent = numberFormat.format(quantity);
    return span;
  }

  const updateAddressVisibility = () => {
    const isDelivery = fulfillmentType.value === 'delivery';
    orderAddressGroup.hidden = !isDelivery;
    orderAddress.required = isDelivery;
    if (!isDelivery) orderAddress.value = '';
  };

  fulfillmentType.addEventListener('change', updateAddressVisibility);
  updateAddressVisibility();

  orderForm.addEventListener('submit', async event => {
    event.preventDefault();
    orderStatus.textContent = '';

    if (!cart.size) {
      orderStatus.textContent = 'أضيفي صنفًا واحدًا على الأقل من المنيو.';
      document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    if (!orderForm.checkValidity()) {
      orderForm.reportValidity();
      orderStatus.textContent = 'راجعي البيانات المطلوبة ثم حاولي مرة أخرى.';
      return;
    }

    const formData = new FormData(orderForm);
    const payload = {
      customerName: String(formData.get('customerName') || '').trim(),
      phone: String(formData.get('phone') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      fulfillmentType: String(formData.get('fulfillmentType') || ''),
      address: String(formData.get('address') || '').trim(),
      notes: String(formData.get('notes') || '').trim(),
      items: [...cart.entries()].map(([productId, quantity]) => ({ productId, quantity }))
    };

    orderSubmit.disabled = true;
    orderStatus.textContent = 'جارٍ إرسال الطلب...';

    try {
      const response = await fetch(API.orders, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await parseApiResponse(response);

      orderStatus.textContent = `تم استلام طلبك ✓ رقم الطلب: ${data.orderNumber} — الإجمالي ${numberFormat.format(data.total)} ر.س`;
      orderStatus.classList.add('success');
      orderForm.reset();
      fulfillmentType.value = 'pickup';
      updateAddressVisibility();
      cart.clear();
      renderCart();
    } catch (error) {
      console.error('Order failed:', error);
      orderStatus.textContent = error.message || 'تعذر إرسال الطلب الآن.';
      orderStatus.classList.remove('success');
    } finally {
      orderSubmit.disabled = false;
    }
  });

  // ---------------- CONTACT ----------------
  const contactForm = document.getElementById('contactForm');
  const formStatus = document.getElementById('formStatus');
  const contactSubmit = contactForm.querySelector('button[type="submit"]');

  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    formStatus.classList.remove('success');

    if (!contactForm.checkValidity()) {
      contactForm.reportValidity();
      formStatus.textContent = 'من فضلك أكمل الحقول المطلوبة بشكل صحيح.';
      return;
    }

    const data = Object.fromEntries(new FormData(contactForm).entries());
    contactSubmit.disabled = true;
    formStatus.textContent = 'جارٍ إرسال الرسالة...';

    try {
      const response = await fetch(API.contact, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await parseApiResponse(response);
      formStatus.textContent = result.message || 'تم استلام رسالتك بنجاح ✓';
      formStatus.classList.add('success');
      contactForm.reset();
    } catch (error) {
      console.error('Contact failed:', error);
      formStatus.textContent = error.message || 'تعذر إرسال الرسالة الآن.';
    } finally {
      contactSubmit.disabled = false;
    }
  });

  // ---------------- NEWSLETTER ----------------
  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterEmail = document.getElementById('newsletterEmail');
  const newsletterStatus = document.getElementById('newsletterStatus');
  const newsletterButton = newsletterForm.querySelector('button[type="submit"]');

  newsletterForm.addEventListener('submit', async event => {
    event.preventDefault();

    if (!newsletterForm.checkValidity()) {
      newsletterForm.reportValidity();
      newsletterStatus.textContent = 'أدخل بريدًا إلكترونيًا صحيحًا.';
      return;
    }

    newsletterButton.disabled = true;
    newsletterStatus.textContent = 'جارٍ تسجيل البريد...';

    try {
      const response = await fetch(API.newsletter, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: newsletterEmail.value.trim() })
      });
      const data = await parseApiResponse(response);
      newsletterStatus.textContent = data.alreadySubscribed ? 'هذا البريد مشترك بالفعل ✓' : 'تم الاشتراك بنجاح ✓';
      newsletterForm.reset();
    } catch (error) {
      console.error('Newsletter failed:', error);
      newsletterStatus.textContent = error.message || 'تعذر تسجيل البريد الآن.';
    } finally {
      newsletterButton.disabled = false;
    }
  });

  async function parseApiResponse(response) {
    let data = {};
    try { data = await response.json(); }
    catch (_) {}
    if (!response.ok) throw new Error(data.error || `خطأ في الخادم (${response.status})`);
    return data;
  }

  document.querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => { image.hidden = true; });
  });

  document.getElementById('currentYear').textContent = new Date().getFullYear();
  loadCatalog();
})();
