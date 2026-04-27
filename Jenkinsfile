pipeline {
    agent any

    environment {
        PROJECT_ID   = "bitirme-pubsub"
        REGION       = "europe-west1"
        REPOSITORY   = "examflow-images"
        IMAGE_API    = "examflow-api"
        IMAGE_EXAM   = "examflow-exam"
        IMAGE_VALIDATION = "examflow-validation"
        IMAGE_WORKER = "examflow-worker"
        CLUSTER_NAME = "examflow-cluster"
        NAMESPACE    = "examflow"

        API_IMAGE_FULL    = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_API}"
        EXAM_IMAGE_FULL   = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_EXAM}"
        VALIDATION_IMAGE_FULL = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_VALIDATION}"
        WORKER_IMAGE_FULL = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_WORKER}"
        IMAGE_TAG         = "${BUILD_NUMBER}"
    }

    stages {
        stage('Show Context') {
            steps {
                echo "BRANCH_NAME=${env.BRANCH_NAME}"
                echo "CHANGE_ID=${env.CHANGE_ID}"
                echo "CHANGE_BRANCH=${env.CHANGE_BRANCH}"
                echo "CHANGE_TARGET=${env.CHANGE_TARGET}"
                sh 'printenv | sort | grep -E "^(BRANCH_NAME|CHANGE_ID|CHANGE_BRANCH|CHANGE_TARGET)=" || true'
            }
        }

        stage('Verify Tools') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                sh 'go version'
                sh 'docker --version'
                sh 'gcloud --version'
                sh 'kubectl version --client'
                sh 'echo "BRANCH_NAME=$BRANCH_NAME"'
                sh 'echo "CHANGE_ID=$CHANGE_ID"'
                sh 'echo "CHANGE_TARGET=$CHANGE_TARGET"'
            }
        }

        stage('Run Tests - API') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/api-service') {
                    sh 'go mod download'
                    sh 'go test ./...'
                }
            }
        }

        stage('Run Tests - Worker') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/worker-service') {
                    sh 'go mod download'
                    sh 'go test ./...'
                }
            }
        }

        stage('Run Tests - Validation') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/validation-service') {
                    sh 'go mod download'
                    sh 'go test ./...'
                }
            }
        }

        stage('Run Tests - Exam') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/exam-service') {
                    sh 'go mod download'
                    sh 'go test ./...'
                }
            }
        }

        stage('Build API Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/api-service') {
                    sh '''
                        docker build \
                          -t $API_IMAGE_FULL:$IMAGE_TAG \
                          -t $API_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('Build Exam Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/exam-service') {
                    sh '''
                        docker build \
                          -t $EXAM_IMAGE_FULL:$IMAGE_TAG \
                          -t $EXAM_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('Build Validation Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/validation-service') {
                    sh '''
                        docker build \
                          -t $VALIDATION_IMAGE_FULL:$IMAGE_TAG \
                          -t $VALIDATION_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('Build Worker Image') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/worker-service') {
                    sh '''
                        docker build \
                          -t $WORKER_IMAGE_FULL:$IMAGE_TAG \
                          -t $WORKER_IMAGE_FULL:latest .
                    '''
                }
            }
        }

        stage('GCP Auth') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([file(credentialsId: 'gcp-sa-key', variable: 'GCP_KEY_FILE')]) {
                    sh '''
                        gcloud auth activate-service-account --key-file="$GCP_KEY_FILE"
                        gcloud config set project $PROJECT_ID
                        gcloud auth configure-docker $REGION-docker.pkg.dev -q
                        gcloud container clusters get-credentials $CLUSTER_NAME --region=$REGION
                        kubectl config current-context
                        kubectl get ns $NAMESPACE
                    '''
                }
            }
        }

        stage('Push Images') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    docker push $API_IMAGE_FULL:$IMAGE_TAG
                    docker push $API_IMAGE_FULL:latest
                    docker push $EXAM_IMAGE_FULL:$IMAGE_TAG
                    docker push $EXAM_IMAGE_FULL:latest
                    docker push $VALIDATION_IMAGE_FULL:$IMAGE_TAG
                    docker push $VALIDATION_IMAGE_FULL:latest
                    docker push $WORKER_IMAGE_FULL:$IMAGE_TAG
                    docker push $WORKER_IMAGE_FULL:latest
                '''
            }
        }

        stage('Deploy with Kustomize') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    cd k8s/overlays/prod

                    echo "Rendered manifest preview:"
                    kubectl kustomize .

                    echo "Exam service deployment manifest is included and image override is applied through kustomize."

                    kubectl apply -k .

                    kubectl rollout status deployment/api-service -n $NAMESPACE         --timeout=180s
                    kubectl rollout status deployment/exam-service -n $NAMESPACE        --timeout=180s
                    kubectl rollout status deployment/validation-service -n $NAMESPACE  --timeout=180s
                    kubectl rollout status deployment/worker-service -n $NAMESPACE      --timeout=180s
                '''
            }
        }

        stage('Smoke Test') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    set -e

                    echo "Running smoke test..."
                    kubectl get pods -n $NAMESPACE

                    kubectl port-forward service/api-service 8080:80 -n $NAMESPACE >/tmp/api-port-forward.log 2>&1 &
                    PF_PID=$!

                    sleep 10

                    curl -f http://127.0.0.1:8080/health

                    kubectl port-forward service/validation-service 8081:80 -n $NAMESPACE >/tmp/validation-port-forward.log 2>&1 &
                    VF_PID=$!

                    sleep 5

                    curl -f http://127.0.0.1:8081/health

                    kubectl port-forward service/exam-service 8082:80 -n $NAMESPACE >/tmp/exam-port-forward.log 2>&1 &
                    EF_PID=$!

                    sleep 5

                    curl -f http://127.0.0.1:8082/health

                    kill $EF_PID || true
                    wait $EF_PID || true

                    kill $VF_PID || true
                    wait $VF_PID || true

                    kill $PF_PID || true
                    wait $PF_PID || true

                    echo "Smoke test passed."
                '''
            }
        }

        stage('Skip Notice for Feature/Fix Pushes') {
            when {
                allOf {
                    not { branch 'develop' }
                    not { branch 'main' }
                    expression { return !env.CHANGE_ID }
                }
            }
            steps {
                echo 'This is a non-PR feature/fix branch push. Build/test/deploy stages are intentionally skipped.'
            }
        }
    }

    post {
        always {
            sh 'docker image prune -f || true'
        }
        success {
            echo 'Pipeline completed successfully.'
        }
        failure {
            echo 'Pipeline failed.'
        }
    }
}
