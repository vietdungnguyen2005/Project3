package dev.vpulse.shared;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class BffAuthenticationFilter extends OncePerRequestFilter {
    private final byte[] expected;

    public BffAuthenticationFilter(@Value("${vpulse.bff-secret}") String secret) {
        this.expected = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var provided = request.getHeader("X-V-Pulse-BFF-Secret");
        if (provided == null || !MessageDigest.isEqual(expected, provided.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(401);
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":\"BFF_AUTH_REQUIRED\",\"message\":\"Trusted BFF required.\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
