// Smooth scroll behavior for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const navHeight = document.querySelector('.nav').offsetHeight;
            const targetPosition = target.offsetTop - navHeight;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// Navbar background change on scroll
const nav = document.querySelector('.nav');
let lastScroll = 0;

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 100) {
        nav.style.boxShadow = '0 2px 20px rgba(138, 115, 85, 0.1)';
    } else {
        nav.style.boxShadow = 'none';
    }
    
    lastScroll = currentScroll;
});

// Intersection Observer for fade-in animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, observerOptions);

// Observe elements with fade-in class
document.addEventListener('DOMContentLoaded', () => {
    // Add observers for cards that should animate on scroll
    const cards = document.querySelectorAll('.value-card, .program-card, .timeline-item, .support-card');
    
    // Reset initial state for scroll-triggered animations
    cards.forEach(card => {
        // Only observe cards that don't have initial animation
        if (!card.style.animation) {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
            observer.observe(card);
        }
    });
});

// Add parallax effect to hero decoration
window.addEventListener('scroll', () => {
    const decoration = document.querySelector('.hero-decoration');
    if (decoration) {
        const scrolled = window.pageYOffset;
        decoration.style.transform = `translate(0, ${scrolled * 0.3}px)`;
    }
});

// Add hover effect sound (optional - commented out)
/*
document.querySelectorAll('.value-card, .program-card, .support-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
        // Add subtle interaction feedback
        card.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    });
});
*/

// Counter animation for metrics (if you want to add numbers later)
function animateCounter(element, target, duration = 2000) {
    let start = 0;
    const increment = target / (duration / 16);
    
    const timer = setInterval(() => {
        start += increment;
        if (start >= target) {
            element.textContent = Math.round(target);
            clearInterval(timer);
        } else {
            element.textContent = Math.round(start);
        }
    }, 16);
}

// Mobile menu toggle (if needed in future)
const createMobileMenu = () => {
    const navLinks = document.querySelector('.nav-links');
    const menuButton = document.createElement('button');
    menuButton.className = 'mobile-menu-button';
    menuButton.innerHTML = '☰';
    menuButton.style.display = 'none';
    
    if (window.innerWidth <= 768) {
        menuButton.style.display = 'block';
        navLinks.style.display = 'none';
    }
    
    menuButton.addEventListener('click', () => {
        navLinks.style.display = navLinks.style.display === 'none' ? 'flex' : 'none';
    });
    
    document.querySelector('.nav-container').insertBefore(menuButton, navLinks);
};

// Lazy loading for images (when you add images)
const lazyLoadImages = () => {
    const images = document.querySelectorAll('img[data-src]');
    const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                imageObserver.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
};

// Drip Lines subscribe form
// - data-endpoint이 있으면 해당 URL로 fetch POST (Formspree 등)
// - 없으면 기본 mailto action 사용 (사용자 메일 클라이언트 열기)
const initDripSubscribe = () => {
    const form = document.getElementById('drip-subscribe');
    if (!form) return;

    const endpoint = form.dataset.endpoint && form.dataset.endpoint.trim();
    if (!endpoint) return; // mailto 폴백 그대로 사용

    const submit = form.querySelector('.drip-form-submit');
    const fallback = form.querySelector('.drip-form-fallback');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const originalLabel = submit.textContent;
        submit.disabled = true;
        submit.textContent = '전송 중…';

        try {
            const data = new FormData(form);
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body: data
            });
            if (!res.ok) throw new Error('network');

            form.innerHTML = `
                <div class="drip-form-success">
                    <h3>구독이 접수되었습니다 ☕</h3>
                    <p>곧 Drip Lines 첫 통을 보내드립니다. 천천히, 한 줄씩.</p>
                </div>`;
        } catch (err) {
            submit.disabled = false;
            submit.textContent = originalLabel;
            if (fallback) {
                fallback.style.color = '#d78c3a';
                fallback.innerHTML = '전송이 실패했어요. 아래 이메일로 직접 보내주세요 — ' + fallback.innerHTML;
            }
        }
    });
};

// 공유 바: 카테고리/노트 페이지(.cat-hero)에 자동 주입 — 전달형 확산 자산
const initShareBar = () => {
    const hero = document.querySelector('.cat-hero');
    if (!hero || document.querySelector('.share-bar')) return;

    const url = location.href.split('#')[0];
    const title = document.title;
    const enc = encodeURIComponent;

    const bar = document.createElement('div');
    bar.className = 'share-bar';
    bar.setAttribute('aria-label', '이 페이지 공유');
    bar.innerHTML = `
        <span class="share-label">이 글이 떠오르는 사람에게 전해주세요</span>
        <div class="share-actions">
            <button type="button" class="share-btn" data-act="native" hidden>공유</button>
            <a class="share-btn" data-act="x" href="https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}" target="_blank" rel="noopener">X</a>
            <a class="share-btn" data-act="fb" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener">페이스북</a>
            <a class="share-btn" data-act="mail" href="mailto:?subject=${enc(title)}&body=${enc(url)}">메일</a>
            <button type="button" class="share-btn" data-act="copy">링크 복사</button>
        </div>`;
    hero.insertAdjacentElement('afterend', bar);

    // 네이티브 공유(모바일/카카오톡 등 OS 공유 시트)
    const nativeBtn = bar.querySelector('[data-act="native"]');
    if (navigator.share) {
        nativeBtn.hidden = false;
        nativeBtn.addEventListener('click', () => {
            navigator.share({ title, url }).catch(() => {});
        });
    }

    // 링크 복사
    bar.querySelector('[data-act="copy"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
            await navigator.clipboard.writeText(url);
            const prev = btn.textContent;
            btn.textContent = '복사됨 ✓';
            setTimeout(() => { btn.textContent = prev; }, 1600);
        } catch (_) {
            window.prompt('아래 링크를 복사하세요', url);
        }
    });
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nedabah Way website loaded');

    lazyLoadImages();
    initDripSubscribe();
    initShareBar();

    // Optional: Add Easter egg
    console.log('%c네다바웨이에 오신 것을 환영합니다', 'color: #8b7355; font-size: 16px; font-weight: bold;');
    console.log('%c자발성으로 시작되는 거룩을 향한 공동체의 길', 'color: #5a4a3a; font-size: 12px;');
});
