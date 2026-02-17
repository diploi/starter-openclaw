FROM nginx:alpine

ARG FOLDER=/app

WORKDIR ${FOLDER}

COPY ./web/not-supported.html /usr/share/nginx/html/index.html
RUN sed -i 's/listen       80;/listen       3000;/' /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
