FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -q -DskipTests dependency:go-offline
COPY src src
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install --yes --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN groupadd --system vpulse && useradd --system --gid vpulse --home-dir /app vpulse
WORKDIR /app
COPY --from=build --chown=vpulse:vpulse /workspace/target/v-pulse-backend-*.jar app.jar
USER vpulse
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]
