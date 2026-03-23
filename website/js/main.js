/**
 * Puerto Studio - Marketing Website JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initMobileMenu();
  initCapabilityTabs();
  initScrollReveal();
  initContactForm();
  initSmoothScroll();
});

/**
 * Navbar scroll behavior
 */
function initNavbar() {
  const navbar = document.getElementById('navbar');
  let lastScroll = 0;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    // Add/remove scrolled class
    if (currentScroll > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  });
}

/**
 * Mobile menu toggle
 */
function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.getElementById('navLinks');

  if (!mobileMenuBtn || !navLinks) return;

  mobileMenuBtn.addEventListener('click', () => {
    mobileMenuBtn.classList.toggle('active');
    navLinks.classList.toggle('mobile-open');
  });

  // Close menu when clicking on a link
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenuBtn.classList.remove('active');
      navLinks.classList.remove('mobile-open');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!navLinks.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      mobileMenuBtn.classList.remove('active');
      navLinks.classList.remove('mobile-open');
    }
  });
}

/**
 * Capability tabs functionality
 */
function initCapabilityTabs() {
  const tabs = document.querySelectorAll('.capability-tab');
  const panels = document.querySelectorAll('.capability-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active panel
      panels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `panel-${targetId}`) {
          panel.classList.add('active');
        }
      });
    });
  });
}

/**
 * Scroll reveal animation
 */
function initScrollReveal() {
  const revealElements = document.querySelectorAll(
    '.feature-card, .benefit-card, .use-case, .pricing-card, .section-header, .studio-feature, .studio-preview'
  );

  // Add data-reveal attribute
  revealElements.forEach(el => {
    el.setAttribute('data-reveal', '');
  });

  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('[data-reveal]').forEach(el => {
    observer.observe(el);
  });
}

/**
 * Contact form handling
 */
function initContactForm() {
  const form = document.getElementById('contactForm');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Get submit button
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px; animation: spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke-opacity="1"></path>
      </svg>
      Enviando...
    `;

    // Simulate form submission (replace with actual API call)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Show success message
    submitBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      ¡Solicitud Enviada!
    `;
    submitBtn.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';

    // Reset form
    form.reset();

    // Reset button after delay
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
      submitBtn.style.background = '';
    }, 3000);

    console.log('Form submitted:', data);
  });
}

/**
 * Smooth scroll for anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));

      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
}

/**
 * Add spin animation keyframes
 */
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

/**
 * Parallax effect for hero section (optional enhancement)
 */
function initParallax() {
  const hero = document.querySelector('.hero');
  const heroContent = document.querySelector('.hero-content');

  if (!hero || !heroContent) return;

  window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const rate = scrolled * 0.3;

    if (scrolled < window.innerHeight) {
      heroContent.style.transform = `translateY(${rate}px)`;
      heroContent.style.opacity = 1 - (scrolled / (window.innerHeight * 0.8));
    }
  });
}

// Initialize parallax (uncomment to enable)
// initParallax();

/**
 * Counter animation for stats
 */
function animateCounters() {
  const counters = document.querySelectorAll('.stat-number');

  counters.forEach(counter => {
    const target = counter.innerText;

    // Skip non-numeric values like '∞'
    if (isNaN(parseInt(target))) return;

    const targetNum = parseInt(target.replace(/\D/g, ''));
    const suffix = target.replace(/[0-9]/g, '');
    let current = 0;
    const increment = targetNum / 50;
    const duration = 1500;
    const stepTime = duration / 50;

    const updateCounter = () => {
      current += increment;
      if (current < targetNum) {
        counter.innerText = Math.floor(current) + suffix;
        setTimeout(updateCounter, stepTime);
      } else {
        counter.innerText = target;
      }
    };

    // Start animation when element is in view
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          updateCounter();
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    observer.observe(counter);
  });
}

// Initialize counter animation
animateCounters();
