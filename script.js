document.addEventListener('DOMContentLoaded', function() {
    // Set the date we're counting down to (30 days from now)
    const countDownDate = new Date();
    countDownDate.setDate(countDownDate.getDate() + 30);
    
    // Update the countdown every 1 second
    const countdownTimer = setInterval(function() {
        // Get today's date and time
        const now = new Date().getTime();
        
        // Find the distance between now and the countdown date
        const distance = countDownDate - now;
        
        // Time calculations for days, hours, minutes and seconds
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        // Display the result
        const daysElement = document.getElementById('days');
        const hoursElement = document.getElementById('hours');
        const minutesElement = document.getElementById('minutes');
        const secondsElement = document.getElementById('seconds');
        
        if (daysElement) daysElement.textContent = days < 10 ? '0' + days : days;
        if (hoursElement) hoursElement.textContent = hours < 10 ? '0' + hours : hours;
        if (minutesElement) minutesElement.textContent = minutes < 10 ? '0' + minutes : minutes;
        if (secondsElement) secondsElement.textContent = seconds < 10 ? '0' + seconds : seconds;
        
        // If the countdown is finished, clear the interval
        if (distance < 0) {
            clearInterval(countdownTimer);
            const countdownContainer = document.getElementById('countdown-timer');
            if (countdownContainer) {
                countdownContainer.innerHTML = '<div>Offer Expired!</div>';
            }
        }
    }, 1000);
    
    // FAQ Accordion Functionality
    const faqQuestions = document.querySelectorAll('.faq-question');
    
    faqQuestions.forEach(question => {
        question.addEventListener('click', function() {
            const faqItem = this.parentElement;
            const isActive = faqItem.classList.contains('active');
            
            // Close all FAQ items
            document.querySelectorAll('.faq-item').forEach(item => {
                item.classList.remove('active');
                const answer = item.querySelector('.faq-answer');
                if (answer) {
                    answer.style.maxHeight = null;
                }
            });
            
            // Toggle the clicked item if it wasn't active
            if (!isActive) {
                faqItem.classList.add('active');
                const answer = this.nextElementSibling;
                if (answer) {
                    answer.style.maxHeight = answer.scrollHeight + 'px';
                }
            }
        });
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Add animation on scroll
    const animateOnScroll = function() {
        const elements = document.querySelectorAll('.benefit-card, .pricing-card, .testimonial, .faq-item');
        
        elements.forEach(element => {
            const elementPosition = element.getBoundingClientRect().top;
            const screenPosition = window.innerHeight / 1.3;
            
            if (elementPosition < screenPosition) {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
            }
        });
    };
    
    // Set initial styles for animation
    document.addEventListener('DOMContentLoaded', function() {
        const elements = document.querySelectorAll('.benefit-card, .pricing-card, .testimonial, .faq-item');
        elements.forEach(element => {
            element.style.opacity = '0';
            element.style.transform = 'translateY(20px)';
            element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        });
        
        // Initial check in case elements are already in view
        animateOnScroll();
    });
    
    // Check on scroll
    window.addEventListener('scroll', animateOnScroll);
    
    // Call to action button click handlers
    const ctaButtons = document.querySelectorAll('.cta-button');
    ctaButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Scroll to the pricing section
            const pricingSection = document.querySelector('.pricing');
            if (pricingSection) {
                window.scrollTo({
                    top: pricingSection.offsetTop - 100,
                    behavior: 'smooth'
                });
            }
            
            // Here you would typically add your form submission or payment processing logic
            console.log('CTA button clicked - ready for integration with payment processor');
        });
    });
    
    // Add a simple form submission handler for the contact form (if added later)
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            // Here you would typically send the form data to your server
            alert('Thank you for your message! We will get back to you soon.');
            contactForm.reset();
        });
    }
});
