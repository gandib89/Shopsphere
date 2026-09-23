FROM quay.io/keycloak/keycloak:26.7.3

COPY --from=realm realm-shopsphere.json /opt/keycloak/data/import/realm-shopsphere.json

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--import-realm", "--http-enabled=true", "--proxy-headers=xforwarded"]
