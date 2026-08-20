package dev.vpulse.shared;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var supplied = request.getHeader("X-Request-Id");
        var requestId = supplied != null && supplied.matches("[A-Za-z0-9_-]{8,64}")
                ? supplied
                : UUID.randomUUID().toString();
        response.setHeader("X-Request-Id", requestId);
        try (var ignored = MDC.putCloseable("requestId", requestId)) {
            chain.doFilter(request, response);
        }
    }
}
