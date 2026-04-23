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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nedabah Way website loaded');
    
    // Add any initialization code here
    lazyLoadImages();
    
    // Optional: Add Easter egg
    console.log('%c네다바웨이에 오신 것을 환영합니다', 'color: #8b7355; font-size: 16px; font-weight: bold;');
    console.log('%c자발성으로 시작되는 거룩을 향한 공동체의 길', 'color: #5a4a3a; font-size: 12px;');
});
