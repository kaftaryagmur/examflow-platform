pipeline {
    agent any

    environment {
        PROJECT_ID   = "bitirme-pubsub"
        REGION       = "europe-west1"
        REPOSITORY   = "examflow-images"
        IMAGE_API    = "examflow-api"
        IMAGE_WORKER = "examflow-worker"
        CLUSTER_NAME = "examflow-cluster"
        NAMESPACE    = "examflow"

        API_IMAGE_FULL    = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_API}"
        WORKER_IMAGE_FULL = "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_WORKER}"
        IMAGE_TAG         = "${BUILD_NUMBER}"
    }

    stages {
        stage('Verify Tools') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                sh 'docker --version'
                sh 'gcloud --version'
                sh 'kubectl version --client'
                sh 'echo "BRANCH_NAME=$BRANCH_NAME"'
                sh 'echo "CHANGE_ID=$CHANGE_ID"'
                sh 'echo "CHANGE_TARGET=$CHANGE_TARGET"'
            }
        }

        stage('Run Tests') {
            when {
                anyOf {
                    branch 'develop'
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                dir('services/api-service') {
                    sh 'go test ./...'
                }
                dir('services/worker-service') {
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
                    docker push $WORKER_IMAGE_FULL:$IMAGE_TAG
                    docker push $WORKER_IMAGE_FULL:latest
                '''
            }
        }

        stage('Update Kubernetes Deployments') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    kubectl get deployment api-service -n $NAMESPACE
                    kubectl get deployment worker-service -n $NAMESPACE

                    kubectl set image deployment/api-service \
                      api-service=$API_IMAGE_FULL:$IMAGE_TAG \
                      -n $NAMESPACE

                    kubectl set image deployment/worker-service \
                      worker-service=$WORKER_IMAGE_FULL:$IMAGE_TAG \
                      -n $NAMESPACE
                '''
            }
        }

        stage('Verify Rollout') {
            when {
                branch 'main'
            }
            steps {
                sh '''
                    kubectl rollout status deployment/api-service -n $NAMESPACE --timeout=180s
                    kubectl rollout status deployment/worker-service -n $NAMESPACE --timeout=180s
                '''
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